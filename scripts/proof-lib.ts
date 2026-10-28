// Proof lab: what every proof script shares. The template inputs (the same for every store except the
// store itself), the Qloo client in record mode (answers already recorded replay; new ones go live and
// are saved under data/proof/fixtures/), and the model through the recording middleware (answers saved
// under data/proof/llm/, so every run and every extraction replays offline).
//
// Everything under data/proof/ holds Qloo answers or real store locations: it is private and listed
// in public-mirror.exclude. Published write-ups name areas only ("Jonesboro", "Kennesaw"), never a
// store's name or address.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { LlmStore, recordingModel, replayModel } from "../lib/agent/llm-replay";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import type { CacheEntry, QlooCache } from "../lib/qloo/cache";
import { createQlooClient, type QlooClient } from "../lib/qloo/client";
import { FixtureCache, loadFixtures } from "../lib/qloo/fixtures";
import type { Limiter } from "../lib/qloo/limiter";
import { RecordingCache } from "../lib/qloo/recording";
import type { PlanInputs, Store } from "../lib/plan/schema";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PROOF = path.join(ROOT, "data", "proof");
export const PROOF_FIXTURES = path.join(PROOF, "fixtures");
export const PROOF_LLM = path.join(PROOF, "llm");
export const PROOF_RUNS = path.join(PROOF, "runs");

/**
 * Rounds: round 1 ran Oct 28 on pipeline 0a7c3fb (data/proof/runs/, answers "proof-<id>"); round 2
 * reran the same stores and inputs on the fixed pipeline (data/proof/runs-2/, answers "proof2-<id>");
 * round 3 is the holdout, 12 stores in a metro the pipeline was never tuned on (runs-3/, "proof3-<id>").
 * Recorded rounds are never rewritten.
 */
export const roundRuns = (round: number) => (round === 1 ? PROOF_RUNS : path.join(PROOF, `runs-${round}`));
export const roundPrefix = (round: number) => (round === 1 ? "proof" : `proof${round}`);
export const roundArg = (args: readonly string[]) => (args.includes("--round") ? Number(args[args.indexOf("--round") + 1]) : 1);
/** The store set a round's store-to-store measures run on. */
export const roundSet = (round: number) => (round >= 3 ? "holdout" : "task2");

/**
 * The chain names the live runtime passes the pipeline (lib/plan/server.ts knownChains): a name on
 * more than one recorded example store's block. Proof runs from round 2 on pass the same set, so they
 * plan exactly as a live run would.
 */
export async function liveKnownChains(): Promise<ReadonlySet<string>> {
  const { loadExampleReport, PLAN_EXAMPLES } = await import("../lib/plan/examples");
  const { repeatedPlaceNames } = await import("../lib/plan/taste");
  const reports = await Promise.all(PLAN_EXAMPLES.map((e) => loadExampleReport(e.slug, ROOT).catch(() => null)));
  return repeatedPlaceNames(reports.flatMap((r) => (r?.local.block ? [r.local.block] : [])));
}

/** JSON for committed files: U+2014 inside Qloo's names is written as an escape so the em dash scan stays clean. */
export const json = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

// --- The template: identical for every store -------------------------------------------------

/** Adults 18 to 34. */
export const TEMPLATE_AGES: PlanInputs["ageBands"] = ["24_and_younger", "25_to_29", "30_to_34"];
/** A Friday afternoon with no holiday on it or the day before. */
export const TEMPLATE_DATE = "2026-11-06";
export const TEMPLATE_START = "14:00";
export const TEMPLATE_MINUTES = 180;
export const TEMPLATE_BUDGET = 50;
export const TEMPLATE_OFFERS: PlanInputs["offers"] = [{ text: "Free phone when you switch (select models)" }, { text: "Unlimited plans from $25/mo" }];
/** Logistics only. Nothing about the neighborhood or who lives there. */
export const TEMPLATE_NOTES = "One folding table and one speaker. One or two of us on staff.";
/** Every store gets the same display name, so only the address, city and point differ. */
export const TEMPLATE_STORE_NAME = "Metro by T-Mobile store";

/** One store in the proof set. `area` is the only label a published write-up uses. */
export interface ProofStore {
  id: string;
  /** Published label, an area name only. */
  area: string;
  /** Private: the street address the plan sees (both Stoop and the generic plan see the same one). */
  address: string;
  /** The city name sent to Qloo (signal.location.query), as resolved by scripts/proof-cities.ts. */
  qlooCity: string;
  /** The store's state, as a manager types it. Rounds 1 and 2: GA. The holdout (round 3): TX. */
  region?: string;
  point: { lat: number; lon: number };
  /** Where the point came from (OSM node, founder). */
  source: string;
  /** "task1" (the Tara Boulevard vs Kennesaw test), "task2" (store to store), or both. */
  sets: ("task1" | "task1-robustness" | "task2" | "holdout")[];
}

export function templateInputs(store: ProofStore): PlanInputs {
  const s: Store = {
    id: store.id,
    name: TEMPLATE_STORE_NAME,
    carrier: "metro",
    address: store.address,
    city: store.qlooCity,
    region: store.region ?? "GA",
    point: store.point,
  };
  return {
    store: s,
    date: TEMPLATE_DATE,
    startTime: TEMPLATE_START,
    durationMinutes: TEMPLATE_MINUTES,
    setting: "sidewalk_table",
    budgetUsd: TEMPLATE_BUDGET,
    offers: TEMPLATE_OFFERS,
    ageBands: [...TEMPLATE_AGES],
    notes: TEMPLATE_NOTES,
  };
}

export function loadStores(): ProofStore[] {
  return readJson<{ stores: ProofStore[] }>(path.join(PROOF, "stores.json")).stores;
}

// --- Qloo: record mode, with every body kept for inspection ------------------------------------

/** Wraps the record-mode cache so a script can read every body the run saw (replayed or fresh). */
export class InspectingCache implements QlooCache {
  readonly seen = new Map<string, { request: string | undefined; entry: CacheEntry }>();
  /** The entry the latest request read or wrote (requests in a proof script run one at a time). */
  last: { request: string | undefined; entry: CacheEntry } | null = null;
  private readonly requests = new Map<string, string>();
  constructor(readonly inner: RecordingCache | FixtureCache) {}

  async get(key: string, request?: string): Promise<CacheEntry | undefined> {
    if (request) this.requests.set(key, request);
    const hit = await this.inner.get(key, request);
    if (hit) {
      this.last = { request, entry: hit };
      this.seen.set(key, this.last);
    }
    return hit;
  }

  async set(key: string, entry: CacheEntry, ttlMs: number): Promise<void> {
    this.last = { request: this.requests.get(key), entry };
    this.seen.set(key, this.last);
    await (this.inner as QlooCache).set(key, entry, ttlMs);
  }
}

const allFixtures = () => [...loadFixtures(path.join(ROOT, "fixtures")), ...loadFixtures(PROOF_FIXTURES)];

/** One shared limiter keeps several clients in one process under Qloo's per-second limit. */
export function recordingClient(apiKey: string, limiter?: Limiter): { client: QlooClient; cache: InspectingCache; recording: RecordingCache } {
  const recording = new RecordingCache(allFixtures());
  const cache = new InspectingCache(recording);
  return { client: createQlooClient({ apiKey, cache, ...(limiter ? { limiter } : {}) }), cache, recording };
}

/** Replays only what is recorded (repo fixtures plus proof fixtures); a miss throws, nothing goes live. */
export function replayClient(): { client: QlooClient; cache: InspectingCache } {
  const cache = new InspectingCache(new FixtureCache(allFixtures(), { strict: true }));
  return { client: createQlooClient({ cache }), cache };
}

/** The locality Qloo resolved for a signal.location.query, from an insights body's `query` block. */
export function resolvedLocality(body: unknown): { name: string; disambiguation: string | null; lat: number | null; lon: number | null } | null {
  const signal = (body as { query?: { localities?: { signal?: { name?: string; disambiguation?: string; location?: { lat?: number; lon?: number } } } } } | null)?.query?.localities?.signal;
  if (!signal?.name) return null;
  return { name: signal.name, disambiguation: signal.disambiguation ?? null, lat: signal.location?.lat ?? null, lon: signal.location?.lon ?? null };
}

// --- Claude: recorded, and every structured answer captured by its output name -----------------

export interface CapturedAnswer {
  /** The structured output's name (e.g. "generic_event_plan"). */
  name: string | null;
  text: string;
}

/** The model for a proof run: recorded to data/proof/llm/<name>.json, each answer captured. */
export function proofModel(name: string, options: { replayOnly?: boolean } = {}): { model: LanguageModel; captured: CapturedAnswer[]; store: LlmStore; modelId: string } {
  const modelId = stoopModelId();
  const store = LlmStore.named(name, PROOF_LLM);
  const base = Object.assign(stoopModel(modelId), { modelId });
  const inner = options.replayOnly ? replayModel(base, store) : recordingModel(base, store);
  const captured: CapturedAnswer[] = [];
  const model = wrapLanguageModel({
    model: inner as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: {
      wrapGenerate: async ({ doGenerate, params }) => {
        const result = await doGenerate();
        const format = params.responseFormat;
        const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
        captured.push({ name: format?.type === "json" ? (format.name ?? null) : null, text });
        return result;
      },
    },
  });
  return { model, captured, store, modelId };
}

export const exists = (file: string) => existsSync(file);
