// A live run's record in the store: its meta, one event list per attempt and the finished report.
//
// Rules every writer follows (the runtime, frames, revise):
// - Seqs come from one counter per attempt, taken as a block, so concurrent writers never share one.
// - A writer names the attempt it started under. A resume starts the next attempt; a writer still
//   finishing the old one writes to the old (abandoned) list and is simply not seen. Frames belong to
//   an attempt: a resumed run renders them again, which costs nothing new because renders are cached
//   by prompt hash and the critique runs through the run's memoized Claude steps. Revisions run only
//   on finished runs, which never resume.
// - Every write keeps the run's keys alive together (list, counter, meta).
// - The stored report is rebuilt from the list once the run has ended, never from a writer's memory.
import { z } from "zod";
import { RUN_META_STATUSES } from "../api/responses";
import { reduce, runEventSchema, toReport, type RunEvent, type RunEventInput } from "../events";
import { reportSchema, type Report } from "../report/schema";
import { keys, TTL } from "./keys";
import type { Store } from "./types";

export const runMetaSchema = z.strictObject({
  runId: z.string().regex(/^run_[0-9a-f]{24}$/),
  attempt: z.number().int().min(1),
  status: z.enum(RUN_META_STATUSES),
  /** The idempotency key: a repeat start of the same brief joins this run. */
  briefHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RunMeta = z.infer<typeof runMetaSchema>;

export async function getRunMeta(store: Store, runId: string): Promise<RunMeta | null> {
  const meta = await store.get<unknown>(keys.run.meta(runId));
  return meta === null ? null : runMetaSchema.parse(meta);
}

export async function setRunMeta(store: Store, meta: RunMeta): Promise<void> {
  await store.set(keys.run.meta(meta.runId), runMetaSchema.parse(meta), { ttlSeconds: TTL.runEvents });
}

/** Appends events to one attempt's list, with a block of seqs from that attempt's counter. Every event is checked before a seq is taken. */
export async function appendRunEvents(store: Store, runId: string, attempt: number, inputs: readonly RunEventInput[], now: () => Date = () => new Date()): Promise<RunEvent[]> {
  if (inputs.length === 0) return [];
  const at = now().toISOString();
  for (const input of inputs) runEventSchema.parse({ ...input, seq: 0, at, attempt });
  const counter = keys.run.seq(runId, attempt);
  const end = await store.incr(counter, { by: inputs.length, ttlSeconds: TTL.runEvents });
  const events = inputs.map((input, i) => runEventSchema.parse({ ...input, seq: end - inputs.length + i, at, attempt }));
  await store.append(keys.run.events(runId, attempt), events, { ttlSeconds: TTL.runEvents });
  await Promise.all([store.expire(counter, TTL.runEvents), store.expire(keys.run.meta(runId), TTL.runEvents)]);
  return events;
}

/** Events of one attempt from a list index on (the list is in write order, which a seq may not be). */
export function readRunEvents(store: Store, runId: string, attempt: number, fromIndex = 0): Promise<RunEvent[]> {
  return store.range<RunEvent>(keys.run.events(runId, attempt), fromIndex, -1);
}

/**
 * Where an SSE stream picks up after `Last-Event-ID`: the list index after the event with that seq.
 * Seqs can land out of order, so this finds the event by seq rather than counting. Unknown: start over
 * (the reducer ignores what the viewer already has).
 */
export function indexAfter(events: readonly Pick<RunEvent, "seq">[], seq: number): number {
  const index = events.findIndex((e) => e.seq === seq);
  return index === -1 ? 0 : index + 1;
}

export async function saveReport(store: Store, report: Report): Promise<void> {
  await store.set(keys.run.report(report.meta.id), reportSchema.parse(report), { ttlSeconds: TTL.report });
}

export async function loadReport(store: Store, runId: string): Promise<Report | null> {
  const report = await store.get<unknown>(keys.run.report(runId));
  return report === null ? null : reportSchema.parse(report);
}

const REFRESH_ROUNDS = 5;

/**
 * Rebuilds the stored report from the current attempt's list once the run has ended (null while it
 * still runs: the runtime's own final refresh covers what lands before the end). After saving it
 * checks the list again, so when two writers refresh at once the last save always holds the longer list.
 */
export async function refreshReport(store: Store, runId: string): Promise<Report | null> {
  for (let round = 0; round < REFRESH_ROUNDS; round++) {
    const meta = await getRunMeta(store, runId);
    if (!meta) throw new Error(`Run ${runId} does not exist.`);
    if (meta.status !== "done" && meta.status !== "failed") return null;
    const events = await readRunEvents(store, runId, meta.attempt);
    const report = toReport(reduce(events));
    await saveReport(store, report);
    if ((await store.length(keys.run.events(runId, meta.attempt))) === events.length) return report;
  }
  throw new Error(`Run ${runId} kept changing while its report was saved.`);
}
