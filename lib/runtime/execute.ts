// One live run, end to end, in the background (`after()`): the same pipeline the examples were
// recorded with (lib/agent/orchestrator.ts runBrief), with live inputs, the shared Qloo client, Claude
// memoized in the store, the LLM-only Control written next to Prove, and a 240 s deadline. Hitting the
// deadline stops the run where it is and marks it resumable; the trace says so.
import type { LanguageModel } from "ai";
import { generateBaseline, type BaselineRun } from "../agent/baseline";
import { CONTROL_RUN } from "../agent/baseline-brief";
import { runBrief, type BriefRun, type Creative } from "../agent/orchestrator";
import { PLATFORMS, type Candidate } from "../demo/candidates";
import type { ReferenceSets } from "../geo/metros";
import type { QlooClient } from "../qloo/client";
import { createLiveRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import type { Cost } from "../report/schema";
import { keys } from "../store/keys";
import { getRunMeta, refreshReport, runLease, setRunMeta } from "../store/runs";
import type { Store } from "../store/types";
import { storeEmitter } from "./emitter";
import { emptyTally, memoizedModel, type ClaudeTally } from "./memo";
import { loadRunRecord, type RunRecord } from "./record";

/** The run stops here, leaving the function (maxDuration 300 s) time to write what it has. */
export const DEADLINE_MS = 240_000;

export interface ExecuteDeps {
  store: Store;
  client: QlooClient;
  model: LanguageModel & { modelId: string };
  reference: ReferenceSets;
  creative: Creative;
  now?: () => number;
  deadlineMs?: number;
  /** Tests only: where the Control comes from (live runs write it with Claude, next to Prove). */
  control?: (record: RunRecord, model: LanguageModel) => Promise<readonly BaselineRun[]>;
  /** Tests only: a recorded example is itself a reference audience, ranked leave-one-out. */
  inReference?: boolean;
}

/** Rough list prices for the estimate in the trace footer (labeled as an estimate): per million tokens. */
export const PRICES = { input: 3, cachedInput: 0.3, output: 15 } as const;

export function estimateUsd(claude: Pick<ClaudeTally, "inputTokens" | "outputTokens" | "cachedInputTokens">): number {
  const fresh = Math.max(0, claude.inputTokens - claude.cachedInputTokens);
  const usd = (fresh * PRICES.input + claude.cachedInputTokens * PRICES.cachedInput + claude.outputTokens * PRICES.output) / 1_000_000;
  return Math.round(usd * 100) / 100;
}

/** The founder's inputs, as the LLM-only Control sees them: the same facts, no Qloo. */
export function liveCandidate(record: RunRecord): Candidate {
  const { product } = record.inputs;
  return {
    slug: product.slug,
    lane: "startup",
    workingName: product.name,
    product: {
      name: product.name,
      description: product.sellerFacts ?? product.oneLine,
      price: "Not given",
      category: "Not given",
      lookDescription: product.source.kind === "description" ? product.source.lookDescription : product.oneLine,
    },
    seeds: record.inputs.seeds.map((s) => s.ref.name),
    statedCustomer: record.inputs.statedCustomer ?? "Not stated.",
    region: record.inputs.region,
    platforms: PLATFORMS,
    direction: record.inputs.direction,
  };
}

class DeadlineError extends Error {
  override name = "DeadlineError";
  constructor() {
    super("The run reached its time limit.");
  }
}

/** The store stopped answering mid-run: nothing the run does now would be kept. */
class StoreDownError extends Error {
  override name = "StoreDownError";
  constructor() {
    super("The run's records could not be saved.");
  }
}

export async function executeRun(deps: ExecuteDeps, runId: string): Promise<void> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const meta = await getRunMeta(store, runId);
  if (!meta || meta.status !== "running") return;
  const lease = runLease(runId, meta.attempt);
  let status: "done" | "stopped" | "failed" = "failed";
  try {
    const record = await loadRunRecord(store, runId);
    if (!record) return;
    const started = now();
    // Stops the run at the deadline, or when the store is down (nothing it did would be kept).
    const stop = new AbortController();
    const emitter = storeEmitter(store, runId, meta.attempt, { onFailure: () => stop.abort(new StoreDownError()) });
    const tally = emptyTally();
    const model = memoizedModel(deps.model, store, runId, tally);
    const monthRemaining = await lastMonthRemaining(store, now());
    const ctx = createLiveRunContext(runId, monthRemaining === undefined ? {} : { monthRemaining });
    const timer = setTimeout(() => stop.abort(new DeadlineError()), deps.deadlineMs ?? DEADLINE_MS);

    // The Control starts with Prove, under the same deadline; the Reality Check gains its line when it lands.
    const control = deps.control
      ? deps.control(record, model)
      : generateBaseline(liveCandidate(record), { model, modelId: deps.model.modelId, run: CONTROL_RUN, abortSignal: stop.signal }).then((run) => [run]);
    control.catch(() => undefined);
    const run: BriefRun = { runId, kind: "live", inputs: record.inputs, stated: record.stated, site: record.site, generic: null, seedEvidence: record.seedEvidence, control, settings: record.settings };

    status = "done";
    try {
      await runBrief({ client: deps.client, ctx, emitter, reference: deps.reference, inReference: deps.inReference ?? false, now, model, modelId: deps.model.modelId, creative: deps.creative, abortSignal: stop.signal }, run);
    } catch (error) {
      if (stop.signal.reason instanceof DeadlineError) {
        // No terminal event: the stream says "stopped" and offers Resume, which redoes nothing already measured or written.
        status = "stopped";
      } else {
        status = "failed";
        const message = stop.signal.reason instanceof StoreDownError ? stop.signal.reason.message : error instanceof Error ? error.message : String(error);
        emitter.emit({ type: "run.failed", stage: null, message });
      }
    } finally {
      clearTimeout(timer);
    }

    if (status !== "stopped") {
      const cost: Cost = {
        durationMs: now() - started,
        qloo: { live: ctx.liveCalls, cached: ctx.cachedCalls },
        claude: { calls: tally.calls, inputTokens: tally.inputTokens, outputTokens: tally.outputTokens, cachedInputTokens: tally.cachedInputTokens },
        frames: 0,
        estimateUsd: estimateUsd(tally),
      };
      emitter.emit({ type: "run.cost", cost });
    }
    try {
      await emitter.flush();
    } catch {
      status = "failed";
    }
    if (emitter.events.some((e) => e.type === "run.failed")) status = "failed";
  } finally {
    // The run's own last word, whatever happened above: what the stream and the report read from now on.
    await setRunMeta(store, { ...meta, status, updatedAt: new Date(now()).toISOString() }).catch(() => undefined);
    if (status !== "stopped") await refreshReport(store, runId).catch(() => null);
    await store.leaseRelease(keys.liveLeases, lease).catch(() => undefined);
  }
}
