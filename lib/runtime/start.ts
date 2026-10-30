// Starting a live run, safely (nothing spent twice, nothing left half-started). In order: the live switch, the founder's text
// through the guardrails, an idempotent start on the brief hash (a repeat joins the run already
// going), the visitor's hourly limit, today's live-run cap, and admission (at most 2 live runs at
// once, as leases that expire if an instance dies). Anything refused becomes an example replay with a
// one-line reason, never an error screen. The run itself starts in the background (`after()` in the
// route), so the founder gets the stream URL at once. A start that fails halfway gives back what it took.
import { after } from "next/server";
import { runStartRequestSchema, type RunStartRequest } from "../api/requests";
import type { RunStartResponse } from "../api/responses";
import { dailyCaps, isLive } from "../config";
import { LEAD_EXAMPLE } from "../demo/examples";
import type { Evidence } from "../evidence";
import { checkText, FAMOUS_PLACES } from "../guardrails";
import { hashOf } from "../hash";
import { defaultPackSettings } from "../prompts/brief";
import type { Seed } from "../report/schema";
import { statedFromText } from "../stages/gap";
import { keys, TTL } from "../store/keys";
import { getRunMeta, liveStatus, runLease, setRunMeta, type RunMeta } from "../store/runs";
import type { Store } from "../store/types";
import { ApiFailure, hourOf } from "./errors";
import { randomHex } from "./intake";
import { loadIntake, saveRunRecord } from "./record";
import type { RequestContext } from "./types";

/** At most this many live runs at once (admission: more than this replays an example, with no queue). */
export const MAX_LIVE_RUNS = 2;
/** A lease outlives the longest run (the 300 s function timeout) a little, so a crashed run frees its slot. */
export const LEASE_MS = 320_000;
export const RUNS_PER_HOUR = 10;
export const RESUMES_PER_HOUR = 6;
/** A claim with no run meta this old belongs to a start that crashed midway; it is replaced. */
export const STALE_CLAIM_MS = 30_000;
/** How long a repeat start waits for a claim's run to appear (a double click lands mid-start). */
export const CLAIM_WAITS_MS = [100, 200, 300, 400] as const;

const REPLAY_MESSAGES = {
  replay: "Live runs are off right now. Here is a full example run instead.",
  busy: "Two live runs are going right now. Here is a full example while you wait.",
  "daily-cap": "Today's live runs are used up. Here is a full example run.",
  "rate-limited": "That is a lot of runs in an hour. Here is a full example run.",
} as const;

export const exampleReply = (reason: keyof typeof REPLAY_MESSAGES): RunStartResponse => ({ mode: "example", slug: LEAD_EXAMPLE.slug, reason, message: REPLAY_MESSAGES[reason] });

const liveReply = (runId: string, joined: boolean): RunStartResponse => ({ mode: "live", runId, eventsUrl: `/api/run/${runId}/events`, reportUrl: `/report/${runId}`, joined });

export interface StartDeps {
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  randomHex?: (bytes: number) => string;
  /** Runs the live run in the background. Defaults to next/server `after()`. */
  schedule?: (task: () => Promise<void>) => void;
  /** The live run itself (lib/runtime/execute.ts), bound to its vendors by the route. `startedAt`: when its invocation began, if earlier work shared it. */
  execute: (runId: string, options?: { startedAt?: number }) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/** The brief hash's claim: which run measures this brief, and since when. */
interface Claim {
  runId: string;
  at: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * What a start does about an existing claim: join its run, replace it (its run failed, or its start
 * crashed before writing the run), or wait briefly for a start still in progress and then join it.
 */
async function settle(store: Store, claim: Claim, deps: StartDeps): Promise<"join" | "replace" | "busy"> {
  const now = deps.now ?? Date.now;
  for (const wait of [0, ...CLAIM_WAITS_MS]) {
    if (wait) await (deps.sleep ?? pause)(wait);
    const meta = await getRunMeta(store, claim.runId);
    if (meta) return meta.status === "failed" ? "replace" : "join";
    if (now() - claim.at > STALE_CLAIM_MS) return "replace";
  }
  return "busy";
}

/** Every seed the intake may confirm: the ones it proposed, and the ones the founder found through search. */
async function confirmable(store: Store, intakeId: string, proposed: readonly Seed[], evidence: readonly Evidence[]) {
  const searched = await store.range<{ seeds: Seed[]; evidence: Evidence }>(keys.intakeSearched(intakeId), 0, -1);
  const seeds = new Map<string, Seed>();
  for (const seed of [...proposed, ...searched.flatMap((s) => s.seeds)]) if (!seeds.has(seed.ref.id)) seeds.set(seed.ref.id, seed);
  const receipts = new Map<string, Evidence>([...evidence, ...searched.map((s) => s.evidence)].map((e) => [e.id, e]));
  return { seeds, receipts };
}

/**
 * The founder's own words reach Claude as quoted data, after the same guardrails as generated text:
 * notes may not name a seed or a famous place (the Control and the concept writer refuse those), and
 * neither notes nor the stated customer may describe people by ethnicity or as minors.
 */
export function founderTextIssues(input: { notes?: string | undefined; statedCustomer: string | null }, seeds: readonly Seed[]): string | null {
  const notes = input.notes ? checkText(input.notes, { names: [...seeds.map((s) => s.ref.name), ...FAMOUS_PLACES] }) : [];
  if (notes.length) return `Your notes can't be used: ${notes[0].message}`;
  const stated = input.statedCustomer ? checkText(input.statedCustomer) : [];
  if (stated.length) return `Describe your customer by age band, place or taste, not by who they are: ${stated[0].message}`;
  return null;
}

export async function startRun(deps: StartDeps, raw: RunStartRequest, ctx: RequestContext): Promise<RunStartResponse> {
  const env = deps.env ?? process.env;
  if (!isLive(env)) return exampleReply("replay");
  const input = runStartRequestSchema.parse(raw);
  const now = deps.now ?? Date.now;
  const { store } = ctx;

  const intake = await loadIntake(store, input.intakeId);
  if (!intake) throw new ApiFailure("not_found", "That product read has expired. Start again from your link.", 404);
  const { seeds: allowed, receipts } = await confirmable(store, input.intakeId, intake.seeds, intake.evidence);
  const seeds = input.seedIds.map((id) => allowed.get(id));
  if (seeds.some((s) => !s)) throw new ApiFailure("invalid", "Pick seeds from the list Qloo found for your product.", 422);
  const chosen = seeds as Seed[];
  const statedCustomer = input.statedCustomer?.trim() || null;
  const refused = founderTextIssues({ notes: input.direction.notes, statedCustomer }, chosen);
  if (refused) throw new ApiFailure("invalid", refused, 422);

  const inputs = { product: intake.product, seeds: chosen, statedCustomer, region: input.region, direction: input.direction };
  // Idempotent on what the run would measure: the same brief joins the run already started for it.
  const briefHash = hashOf({ ...inputs, seeds: chosen.map((s) => s.ref.id).sort() });
  const claimKey = keys.brief(briefHash);
  const claimed = await store.get<Claim>(claimKey);
  if (claimed) {
    const outcome = await settle(store, claimed, deps);
    if (outcome === "join") return liveReply(claimed.runId, true);
    if (outcome === "busy") return exampleReply("busy");
  }

  if ((await store.incr(keys.rate("run", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 })) > RUNS_PER_HOUR) return exampleReply("rate-limited");
  const dailyKey = keys.daily("live-runs");
  if ((await store.incr(dailyKey, { ttlSeconds: TTL.daily })) > dailyCaps(env).liveRuns) return exampleReply("daily-cap");

  const runId = `run_${(deps.randomHex ?? randomHex)(12)}`;
  const lease = runLease(runId, 1);
  const claimedAt = now();
  let leased = false;
  let ours = false;
  let scheduled = false;
  try {
    leased = await store.leaseAcquire(keys.liveLeases, lease, { max: MAX_LIVE_RUNS, ttlMs: LEASE_MS, now: now() });
    if (!leased) return exampleReply("busy");
    // A claim left by a failed run (or a start that crashed before its meta) is replaced, only while
    // it is still that claim: if another start replaced it first, this one joins theirs.
    if (claimed) await store.deleteIfEquals(claimKey, claimed);
    ours = await store.set(claimKey, { runId, at: claimedAt } satisfies Claim, { ifAbsent: true, ttlSeconds: TTL.runEvents });
    if (!ours) {
      const other = await store.get<Claim>(claimKey);
      return other && (await settle(store, other, deps)) === "join" ? liveReply(other.runId, true) : exampleReply("busy");
    }
    const at = new Date(now()).toISOString();
    const stated = statedCustomer === intake.statedCustomer ? intake.stated : statedCustomer ? statedFromText(statedCustomer) : null;
    const seedEvidence = [...new Set(chosen.flatMap((s) => s.evidenceIds))].flatMap((id) => receipts.get(id) ?? []);
    await saveRunRecord(store, runId, { inputs, stated, site: intake.site, seedEvidence, settings: defaultPackSettings(inputs.direction) });
    // Who started it: its storyboards count against this visitor's day (lib/media/storyboards.ts).
    const meta: RunMeta = { runId, attempt: 1, status: "running", briefHash, createdAt: at, updatedAt: at, visitor: ctx.visitor, cookieVisitor: ctx.cookieVisitor ?? null };
    await setRunMeta(store, meta);
    (deps.schedule ?? after)(() => deps.execute(runId, ctx.startedAt !== undefined ? { startedAt: ctx.startedAt } : {}));
    scheduled = true;
    return liveReply(runId, false);
  } finally {
    if (!scheduled) {
      // Nothing started: give back the slot, the day's count and the claim.
      await Promise.allSettled([
        leased ? store.leaseRelease(keys.liveLeases, lease) : Promise.resolve(),
        store.incr(dailyKey, { by: -1 }),
        ours ? store.deleteIfEquals(claimKey, { runId, at: claimedAt }) : Promise.resolve(),
      ]);
    }
  }
}

/**
 * Resumes a run that stopped (the deadline) or whose instance died (still "running", lease gone).
 * The next attempt is claimed first, so two Resume clicks never run it twice. It streams again from
 * seq 0; its Qloo answers come from the shared cache and its Claude steps from the run's memo, so it
 * costs nothing until it passes where the last attempt stopped.
 */
export async function resumeRun(deps: StartDeps, runId: string, ctx: RequestContext): Promise<RunStartResponse> {
  if (!isLive(deps.env ?? process.env)) return exampleReply("replay");
  const now = deps.now ?? Date.now;
  const { store } = ctx;
  const meta = await getRunMeta(store, runId);
  if (!meta) throw new ApiFailure("not_found", "That run has expired.", 404);
  if ((await liveStatus(store, meta, now())) !== "stopped") return liveReply(runId, true);
  if ((await store.incr(keys.rate("resume", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 })) > RESUMES_PER_HOUR) {
    throw new ApiFailure("rate_limited", "That run has been resumed a lot this hour. Try again a little later.", 429);
  }
  const attempt = meta.attempt + 1;
  const claim = keys.run.attempt(runId, attempt);
  if (!(await store.set(claim, true, { ifAbsent: true, ttlSeconds: TTL.runEvents }))) return liveReply(runId, true);
  const lease = runLease(runId, attempt);
  let leased = false;
  let scheduled = false;
  try {
    leased = await store.leaseAcquire(keys.liveLeases, lease, { max: MAX_LIVE_RUNS, ttlMs: LEASE_MS, now: now() });
    if (!leased) throw new ApiFailure("busy", "Two live runs are going right now. Try Resume again in a minute.", 503);
    await setRunMeta(store, { ...meta, attempt, status: "running", updatedAt: new Date(now()).toISOString() });
    (deps.schedule ?? after)(() => deps.execute(runId));
    scheduled = true;
    return liveReply(runId, false);
  } finally {
    if (!scheduled) await Promise.allSettled([leased ? store.leaseRelease(keys.liveLeases, lease) : Promise.resolve(), store.del(claim)]);
  }
}
