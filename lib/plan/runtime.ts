// Starting and running a live plan, with the same safety as Stoop's runs (lib/runtime/start.ts): the
// live switch, the manager's notes through the guard, an idempotent start on the input hash (a repeat
// joins the plan already going), the visitor's hourly limit, today's live-run cap (shared with every
// live run), and admission (a few plans at once, as leases that expire if an instance dies). Anything
// refused becomes an example replay with a one-line reason, never an error screen. The plan itself
// runs in the background (`after()` in the route) and writes its events to the store as it goes.
import type { LanguageModel } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { failureForLog, plainFailure } from "../agent/failure";
import { dailyCaps, isLive } from "../config";
import { hashOf } from "../hash";
import { MONTHLY_FLOOR, PLAN_BUDGET, PLAN_CAP } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import { ApiFailure, hourOf } from "../runtime/errors";
import { randomHex } from "../runtime/intake";
import { estimateUsd } from "../runtime/cost";
import { emptyTally, memoizedModel } from "../runtime/memo";
import type { RequestContext } from "../runtime/types";
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import type { PlanSink } from "./env";
import { createPlanEmitter, planEventSchema, type PlanEvent, type PlanEventInput } from "./events";
import { examplePlanId, LEAD_PLAN_EXAMPLE, PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES, type PlanExampleSlug } from "./example-list";
import { guardFor, runPlan } from "./pipeline";
import { textIssues } from "./guard";
import { inputsSchema, type PlanInputs } from "./schema";
import { appendPlanEvents, getPlanMeta, setPlanMeta, type PlanMeta } from "./store";

/** Plans at once (admission: more than this replays an example, with no queue). */
export const MAX_LIVE_PLANS = 3;
/** A lease outlives the longest plan (maxDuration 300 s) a little, so a crashed plan frees its slot. */
export const PLAN_LEASE_MS = 320_000;
export const PLANS_PER_HOUR = 6;
/** The plan stops here, leaving the function time to write what it has. */
export const PLAN_DEADLINE_MS = 240_000;
/** A claim with no meta this old belongs to a start that crashed midway; it is replaced. */
export const STALE_CLAIM_MS = 30_000;

/** POST /api/plan's body: the inputs, as /start collects them. */
export const planStartRequestSchema = z.strictObject({ inputs: inputsSchema });
export type PlanStartRequest = z.infer<typeof planStartRequestSchema>;

export const PLAN_REPLAY_REASONS = ["replay", "busy", "daily-cap", "rate-limited"] as const;
export type PlanReplayReason = (typeof PLAN_REPLAY_REASONS)[number];

const REPLAY_MESSAGES: Record<PlanReplayReason, string> = {
  replay: "Live plans are off right now. Here is a full example plan instead.",
  busy: "A few live plans are running right now. Here is a full example while you wait.",
  "daily-cap": "Today's live plans are used up. Here is a full example plan.",
  "rate-limited": "That is a lot of plans in an hour. Here is a full example plan.",
};

export type PlanStartResponse =
  | { mode: "live"; id: string; eventsUrl: string; planUrl: string; joined: boolean }
  | { mode: "example"; slug: PlanExampleSlug; id: string; planUrl: string; reason: PlanReplayReason; message: string };

/** The example closest to what was asked for: the same city when there is one, else the lead. */
export function exampleFor(inputs: PlanInputs | null): PlanExampleSlug {
  const city = inputs?.store.city.trim().toLowerCase();
  return PLAN_EXAMPLES.find((e) => city && PLAN_EXAMPLE_INPUTS[e.slug].store.city.toLowerCase() === city)?.slug ?? LEAD_PLAN_EXAMPLE.slug;
}

export function exampleReply(reason: PlanReplayReason, inputs: PlanInputs | null = null): PlanStartResponse {
  const slug = exampleFor(inputs);
  return { mode: "example", slug, id: examplePlanId(slug), planUrl: `/examples/stores/${slug}`, reason, message: REPLAY_MESSAGES[reason] };
}

const liveReply = (id: string, joined: boolean): PlanStartResponse => ({ mode: "live", id, eventsUrl: `/api/plan/${id}/events`, planUrl: `/plan/${id}`, joined });

export interface PlanStartDeps {
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  /** Runs the plan in the background. Defaults to next/server `after()`. */
  schedule?: (task: () => Promise<void>) => void;
  execute: (runId: string) => Promise<void>;
}

interface Claim {
  runId: string;
  at: number;
}

/** The manager's notes pass the same guard as generated text before anything starts. */
export function notesProblem(inputs: PlanInputs): string | null {
  if (!inputs.notes) return null;
  const problems = textIssues(inputs.notes, guardFor(inputs));
  return problems.length ? `Your notes can't be used: ${problems[0]}` : null;
}

export async function startPlan(deps: PlanStartDeps, raw: unknown, ctx: RequestContext): Promise<PlanStartResponse> {
  const env = deps.env ?? process.env;
  const { inputs } = planStartRequestSchema.parse(raw);
  if (!isLive(env)) return exampleReply("replay", inputs);
  const refused = notesProblem(inputs);
  if (refused) throw new ApiFailure("invalid", refused.slice(0, 300), 422);
  const now = deps.now ?? Date.now;
  const { store } = ctx;

  // Idempotent on what the plan would measure: the same inputs join the plan already started for them.
  const inputHash = hashOf(inputs);
  const claimKey = keys.planClaim(inputHash);
  const claimed = await store.get<Claim>(claimKey);
  if (claimed) {
    const meta = await getPlanMeta(store, claimed.runId);
    if (meta && meta.status !== "failed") return liveReply(claimed.runId, true);
    if (!meta && now() - claimed.at <= STALE_CLAIM_MS) return exampleReply("busy", inputs);
  }

  if ((await store.incr(keys.rate("plan", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 })) > PLANS_PER_HOUR) return exampleReply("rate-limited", inputs);
  const dailyKey = keys.daily("live-runs");
  if ((await store.incr(dailyKey, { ttlSeconds: TTL.daily })) > dailyCaps(env).liveRuns) {
    await store.incr(dailyKey, { by: -1 }).catch(() => undefined);
    return exampleReply("daily-cap", inputs);
  }

  const runId = `plan_${(deps.randomHex ?? randomHex)(12)}`;
  const claimedAt = now();
  let leased = false;
  let ours = false;
  let scheduled = false;
  try {
    leased = await store.leaseAcquire(keys.planLeases, runId, { max: MAX_LIVE_PLANS, ttlMs: PLAN_LEASE_MS, now: now() });
    if (!leased) return exampleReply("busy", inputs);
    if (claimed) await store.deleteIfEquals(claimKey, claimed);
    ours = await store.set(claimKey, { runId, at: claimedAt } satisfies Claim, { ifAbsent: true, ttlSeconds: TTL.report });
    if (!ours) {
      const other = await store.get<Claim>(claimKey);
      return other ? liveReply(other.runId, true) : exampleReply("busy", inputs);
    }
    const at = new Date(now()).toISOString();
    await store.set(keys.planInput(runId), inputs, { ttlSeconds: TTL.report });
    const visitor = /^[vt]_[0-9a-f]{24}$/.test(ctx.visitor) ? { visitor: ctx.visitor } : {};
    await setPlanMeta(store, { runId, status: "running", inputHash, createdAt: at, updatedAt: at, ...visitor });
    (deps.schedule ?? after)(() => deps.execute(runId));
    scheduled = true;
    return liveReply(runId, false);
  } finally {
    if (!scheduled) {
      await Promise.allSettled([
        leased ? store.leaseRelease(keys.planLeases, runId) : Promise.resolve(),
        store.incr(dailyKey, { by: -1 }),
        ours ? store.deleteIfEquals(claimKey, { runId, at: claimedAt }) : Promise.resolve(),
      ]);
    }
  }
}

/** Emitted events go to the store in small batches; each is checked when emitted, so a bad event fails its stage. */
export const FLUSH_MS = 150;

export interface StorePlanSink extends PlanSink {
  events: PlanEvent[];
  flush(): Promise<void>;
}

export function storePlanSink(store: Store, runId: string, options: { now?: () => Date; onFailure?: (error: unknown) => void } = {}): StorePlanSink {
  const stamp = createPlanEmitter(options.now);
  const events: PlanEvent[] = [];
  let pending: PlanEvent[] = [];
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failure: unknown = null;
  const write = () => {
    timer = null;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return chain;
    chain = chain.then(async () => {
      if (failure) return;
      for (let tries = 0; ; tries++) {
        try {
          events.push(...(await appendPlanEvents(store, runId, batch)));
          return;
        } catch (error) {
          if (tries >= 2) {
            failure = error;
            options.onFailure?.(error);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 200 * 4 ** tries));
        }
      }
    });
    return chain;
  };
  return {
    events,
    emit(input: PlanEventInput) {
      const event = stamp(input);
      pending.push(event);
      timer ??= setTimeout(write, FLUSH_MS);
      return event;
    },
    async flush() {
      if (timer) clearTimeout(timer);
      await write();
      if (failure) throw failure;
    },
  };
}

export interface PlanExecuteDeps {
  store: Store;
  client: QlooClient;
  model: LanguageModel & { modelId: string };
  /** Names the recorded runs found on more than one store's block (lib/plan/taste.ts repeatedPlaceNames). */
  knownChains?: ReadonlySet<string>;
  now?: () => number;
  deadlineMs?: number;
}

class PlanDeadlineError extends Error {
  override name = "TimeoutError";
  constructor() {
    super("The plan reached its time limit.");
  }
}

/** One live plan, end to end, in the background. Its meta's last word and its lease are always settled. */
export async function executePlan(deps: PlanExecuteDeps, runId: string): Promise<void> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const meta = await getPlanMeta(store, runId);
  if (!meta || meta.status !== "running") return;
  let status: PlanMeta["status"] = "failed";
  try {
    const inputs = inputsSchema.parse(await store.get<unknown>(keys.planInput(runId)));
    const stop = new AbortController();
    const sink = storePlanSink(store, runId, { onFailure: () => stop.abort(new Error("store down")) });
    const tally = emptyTally();
    const model = memoizedModel(deps.model, store, runId, tally);
    const monthRemaining = await lastMonthRemaining(store, now());
    const ctx = createRunContext({ runId, cap: PLAN_CAP, rowCaps: PLAN_BUDGET, monthlyFloor: MONTHLY_FLOOR, ...(monthRemaining === undefined ? {} : { monthRemaining }) });
    const timer = setTimeout(() => stop.abort(new PlanDeadlineError()), deps.deadlineMs ?? PLAN_DEADLINE_MS);
    const started = now();
    try {
      const outcome = await runPlan({ client: deps.client, ctx, sink, model, abortSignal: stop.signal, ...(deps.knownChains ? { knownChains: deps.knownChains } : {}) }, { runId, kind: "live", inputs }, { now });
      status = outcome.status;
      sink.emit({
        type: "run.cost",
        cost: {
          durationMs: now() - started,
          qloo: { live: ctx.liveCalls, cached: ctx.cachedCalls },
          claude: { calls: tally.calls, inputTokens: tally.inputTokens, outputTokens: tally.outputTokens, cachedInputTokens: tally.cachedInputTokens },
          frames: 0,
          estimateUsd: estimateUsd(tally),
        },
      });
      sink.emit({ type: "run.done" });
    } catch (error) {
      status = "failed";
      const cause = stop.signal.reason instanceof Error ? stop.signal.reason : error;
      console.error(`[plan ${runId}] failed: ${failureForLog(cause)}`);
      sink.emit({ type: "run.failed", stage: null, message: plainFailure(cause) });
    } finally {
      clearTimeout(timer);
    }
    try {
      await sink.flush();
    } catch {
      status = "failed";
    }
  } catch (error) {
    console.error(`[plan ${runId}] could not run: ${failureForLog(error)}`);
    status = "failed";
  } finally {
    await setPlanMeta(store, { ...meta, status, updatedAt: new Date(now()).toISOString() }).catch(() => undefined);
    await store.leaseRelease(keys.planLeases, runId).catch(() => undefined);
  }
}

/** Checks an event before it reaches a list (used by writers outside the pipeline, such as results). */
export const checkEvent = (event: PlanEvent) => planEventSchema.parse(event);
