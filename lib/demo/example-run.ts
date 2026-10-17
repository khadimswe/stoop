// Builds and records an example's audience run from the recorded fixtures: the candidate's product
// (with its approved brand name), its seeds resolved by typed search, the stated customer, and what
// its LLM-only Control assumed. Replay only: a strict FixtureCache, so a missing recording throws.
// The clock is fixed, so the stored run is byte-for-byte reproducible (the golden test re-runs it).
import type { LanguageModel } from "ai";
import { CONTROL_RUN, candidateDirection, candidateProduct } from "../agent/baseline-brief";
import { LlmStore, replayModel } from "../agent/llm-replay";
import { stoopModel, stoopModelId } from "../agent/model";
import { runBrief, type BriefRun, type Creative } from "../agent/orchestrator";
import { defaultPackSettings } from "../prompts/brief";
import { loadRuns } from "../data-check/plan";
import { createEmitter, reduce, toReport, type RunEvent } from "../events";
import type { Evidence } from "../evidence";
import { referenceSets } from "../geo/reference";
import { OFFLINE_CAP } from "../qloo/budget";
import { createQlooClient, type QlooClient } from "../qloo/client";
import { createRunContext, type RunContext } from "../qloo/context";
import { FixtureCache, findFixture, readFixtureFile } from "../qloo/fixtures";
import { matchResult } from "../qloo/match";
import { searchEntities } from "../qloo/search";
import type { Report, Seed } from "../report/schema";
import { runAudience, type AudienceRun } from "../stages/audience";
import { statedFromText } from "../stages/gap";
import { candidateBySlug } from "./candidates";
import { EXAMPLES, type ExampleSlug } from "./examples";
import { seedType } from "./seed-types";

/** How the reference file names a candidate audience (scripts/data-check.ts writes the members). */
export const candidateMember = (slug: string) => `candidate--${slug}`;

/** When the example runs were recorded; every event time counts up from here. */
export const RECORDED_AT = Date.parse("2026-10-16T20:00:00.000Z");

async function resolveSeeds(client: QlooClient, ctx: RunContext, names: readonly string[]): Promise<{ seeds: Seed[]; evidence: Evidence[] }> {
  const seeds: Seed[] = [];
  const evidence: Evidence[] = [];
  for (const name of names) {
    const type = seedType(name);
    const result = await searchEntities(client, ctx, { query: name, types: [`urn:entity:${type}`], take: 5 }, { label: `Resolving ${name} to a ${type.replace("_", " ")} entity`, stage: "prove" });
    evidence.push(result.evidence);
    const hit = matchResult(name, result.data);
    if (!hit) continue;
    seeds.push({
      ref: { kind: "entity", id: hit.result.id, name: hit.result.name, type: hit.result.type ?? `urn:entity:${type}` },
      origin: "you",
      match: hit.match,
      evidenceIds: [result.evidence.id],
    });
  }
  return { seeds, evidence };
}

export async function buildExampleRun(slug: ExampleSlug, client: QlooClient, ctx: RunContext): Promise<AudienceRun> {
  const example = EXAMPLES.find((e) => e.slug === slug);
  const candidate = candidateBySlug(slug);
  if (!example || !candidate) throw new Error(`No example "${slug}".`);
  const { seeds, evidence } = await resolveSeeds(client, ctx, candidate.seeds);
  const control = loadRuns(slug).find((r) => r.run === CONTROL_RUN);
  if (!control) throw new Error(`${slug} has no Control run.`);
  return {
    runId: `example-${slug}`,
    kind: "example",
    inputs: {
      product: { ...candidateProduct(candidate), brandName: example.brandName },
      seeds,
      statedCustomer: candidate.statedCustomer,
      region: candidate.region,
      direction: candidateDirection(candidate),
    },
    stated: statedFromText(candidate.statedCustomer),
    site: null,
    generic: { ages: control.brief.audience.ageBands, gender: control.brief.audience.genderSkew, cities: control.brief.assumedCities },
    seedEvidence: evidence,
  };
}

/**
 * The recordings the audience stages read for the examples: seed searches, the whole-audience and
 * segment calls, Gate 2's scoring calls (the Reality Check's taste check) and the pet hats re-score.
 * Loading only these (not every fixture, about 45 MB) keeps replays fast; a missing one still throws.
 * A new recording the examples read goes in this list too (scripts/run-audience.ts reads every fixture).
 */
export const AUDIENCE_FIXTURES = ["pool-resolve", "pool-audience", "pool-segments", "pool-scoring", "pool-refresh-2", "pool-refresh-3", "audience-segments"] as const;

export function replayClient(names: readonly string[] = AUDIENCE_FIXTURES, dir = "fixtures"): QlooClient {
  const fixtures = names.map((name) => {
    const file = findFixture(name, dir);
    if (!file) throw new Error(`No fixture named ${name} in ${dir}/.`);
    return readFixtureFile(file);
  });
  return createQlooClient({ cache: new FixtureCache(fixtures, { strict: true }) });
}

/** An example's full brief run: its audience run plus the Control's 3 recorded runs and the shared pack settings. */
export async function buildExampleBrief(slug: ExampleSlug, client: QlooClient, ctx: RunContext): Promise<BriefRun> {
  const run = await buildExampleRun(slug, client, ctx);
  const candidate = candidateBySlug(slug);
  if (!candidate) throw new Error(`No candidate "${slug}".`);
  return { ...run, control: loadRuns(slug), settings: defaultPackSettings(candidateDirection(candidate)) };
}

/**
 * Runs an example end to end (audience, worlds, Control, comparison) with a fixed clock and zero
 * durations, so a replay is byte-for-byte reproducible. Qloo answers come from `client` (strict
 * replay, or record mode in the script) and Claude's from `model` (recorded answers in replay).
 */
export async function recordExampleBrief(
  slug: ExampleSlug,
  options: { client: QlooClient; model: LanguageModel; modelId: string; creative: Creative },
): Promise<{ events: RunEvent[]; report: Report }> {
  const ctx = createRunContext({ runId: `example-${slug}`, cap: OFFLINE_CAP });
  let t = RECORDED_AT;
  const emitter = createEmitter(() => new Date((t += 100)));
  const run = await buildExampleBrief(slug, options.client, ctx);
  const reference = referenceSets();
  const inReference = reference.full.members.includes(candidateMember(slug));
  await runBrief({ client: options.client, ctx, emitter, reference, inReference, now: () => 0, model: options.model, modelId: options.modelId, creative: options.creative }, run);
  return { events: emitter.events, report: toReport(reduce(emitter.events)) };
}

/**
 * Strict replay for an example: every recorded Qloo answer (fixtures/) and its recorded Claude answers
 * (fixtures/llm/<slug>.json). No key, no network: a request nobody recorded throws.
 */
export function replayOptions(slug: ExampleSlug, creative: Creative): { client: QlooClient; model: LanguageModel; modelId: string; creative: Creative } {
  const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
  const modelId = stoopModelId({});
  const model = replayModel(Object.assign(stoopModel(modelId), { modelId }), LlmStore.named(slug));
  return { client, model, modelId, creative };
}

/** Runs an example's audience stages on the fixtures and returns its events and the reduced report. */
export async function recordExampleAudience(slug: ExampleSlug, client: QlooClient = replayClient()): Promise<{ events: RunEvent[]; report: Report }> {
  const ctx = createRunContext({ runId: `example-${slug}`, cap: OFFLINE_CAP });
  let t = RECORDED_AT;
  const emitter = createEmitter(() => new Date((t += 100)));
  const run = await buildExampleRun(slug, client, ctx);
  // A recorded candidate is one of the reference audiences, so it is ranked leave-one-out.
  const reference = referenceSets();
  const inReference = reference.full.members.includes(candidateMember(slug));
  await runAudience({ client, ctx, emitter, reference, inReference, now: () => 0 }, run);
  return { events: emitter.events, report: toReport(reduce(emitter.events)) };
}
