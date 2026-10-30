// A plan's record in the store, for every writer (the pipeline, marketing, logged results):
// - one event list per plan id, and one seq counter every writer takes its seqs from, so writers in
//   different invocations never share a seq (the reducer drops a repeated seq);
// - a live plan's meta (status, input hash, starter, owner);
// - examples ("ex-<slug>") keep their recorded run in data/plans and only what was added after it
//   here, with seqs after the recording's last, so the two lists fold together.
// The report is never stored: it is reduced from the events on read, so it can never drift from them.
import { z } from "zod";
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { planEventSchema, reducePlan, toPlanReport, type PlanEvent } from "./events";
import { loadExampleEvents, planExampleSlug } from "./examples";
import type { PlanReport } from "./schema";

/** "plan_" plus 24 hex: a live plan. */
export const livePlanIdSchema = z.string().regex(/^plan_[0-9a-f]{24}$/);
/** A live plan id or an example's "ex-<slug>". */
export const planIdSchema = z.string().refine((id) => livePlanIdSchema.safeParse(id).success || planExampleSlug(id) !== null, { error: "not a plan id" });

export const PLAN_META_STATUSES = ["running", "done", "partial", "failed"] as const;
export const planMetaSchema = z.strictObject({
  runId: livePlanIdSchema,
  status: z.enum(PLAN_META_STATUSES),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Who started it, as a salted id only (the IP's, or an MCP token's). */
  visitor: z.string().regex(/^[vt]_[0-9a-f]{24}$/).optional(),
  /** The signed visitor cookie id of the browser that started it: the plan's owner (lib/plan/owner.ts). */
  owner: z.string().regex(/^c_[0-9a-f]{24}$/).optional(),
});
export type PlanMeta = z.infer<typeof planMetaSchema>;

export async function getPlanMeta(store: Store, runId: string): Promise<PlanMeta | null> {
  const meta = await store.get<unknown>(keys.planMeta(runId));
  return meta === null ? null : planMetaSchema.parse(meta);
}

export async function setPlanMeta(store: Store, meta: PlanMeta): Promise<void> {
  await store.set(keys.planMeta(meta.runId), planMetaSchema.parse(meta), { ttlSeconds: TTL.plan });
}

/** Recorded events of an example, or none for a live plan. */
async function recorded(runId: string): Promise<PlanEvent[]> {
  const slug = planExampleSlug(runId);
  return slug ? loadExampleEvents(slug) : [];
}

const lastSeq = (events: readonly PlanEvent[]) => events.reduce((max, e) => Math.max(max, e.seq), -1);

/** The keys that live as long as a plan's events, beside its list and seq: each write refreshes them all. */
const companionKeys = (runId: string) => [keys.planMeta(runId), keys.planInput(runId), keys.planVariantB(runId)];

/**
 * Appends events to a plan's list. Each event's seq is replaced by the next one from the plan's
 * counter (after an example's recorded seqs), so any writer may build its events with its own
 * emitter; `at` and the rest are kept. Every event is checked before a seq is taken. Returns the
 * events as stored. The plan's other keys (meta, inputs, variant B) get the same new TTL, so no part
 * of a plan expires before the rest.
 */
export async function appendPlanEvents(store: Store, runId: string, events: readonly PlanEvent[]): Promise<PlanEvent[]> {
  if (events.length === 0) return [];
  for (const event of events) planEventSchema.parse(event);
  const offset = planExampleSlug(runId) ? lastSeq(await recorded(runId)) + 1 : 0;
  const end = await store.incr(keys.planSeq(runId), { by: events.length, ttlSeconds: TTL.plan });
  const stored = events.map((event, i) => planEventSchema.parse({ ...event, seq: offset + end - events.length + i }));
  await store.expire(keys.planSeq(runId), TTL.plan);
  await store.append(keys.planEvents(runId), stored, { ttlSeconds: TTL.plan });
  // A key that does not exist (an example's meta, a plan with no variant B) is left alone.
  await Promise.all(companionKeys(runId).map((key) => store.expire(key, TTL.plan).catch(() => undefined)));
  return stored;
}

/** Events added in the store, from a list index on. */
export function readStoredPlanEvents(store: Store, runId: string, fromIndex = 0): Promise<PlanEvent[]> {
  return store.range<PlanEvent>(keys.planEvents(runId), fromIndex, -1);
}

/**
 * Every event of a plan: an example's recording plus what was added to it, or a live plan's list.
 * For an example, a store that cannot answer only means nothing was added: the recording still loads.
 */
export async function loadPlanEvents(store: Store | null, runId: string): Promise<PlanEvent[]> {
  const base = await recorded(runId);
  if (!store) return base;
  try {
    return [...base, ...(await readStoredPlanEvents(store, runId))];
  } catch (error) {
    if (base.length > 0) return base;
    throw error;
  }
}

/** The plan's report so far, reduced from its events; null when the plan never started. */
export async function loadPlanReport(store: Store | null, runId: string): Promise<PlanReport | null> {
  const events = await loadPlanEvents(store, runId);
  const state = reducePlan(events);
  if (!state.runId) return null;
  return toPlanReport(state);
}
