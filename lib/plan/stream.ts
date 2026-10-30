// A plan's server-sent event stream. Live plans: the plan's list in the store, from where the viewer
// left off (`Last-Event-ID` is the last seq it has), plus a status message whenever the plan's status
// changes. Examples: the recorded run (and anything added to it since), paced so it reads like a run.
// Marketing (the poster and posts) runs after the plan: while it is under way the stream stays open,
// polling more slowly; a plan that has ended with nothing more on the way closes within a few seconds
// (a little after it ended, so marketing that starts on its own can still begin). Every event is a
// PlanEvent, so one reducer (reducePlan) reads them all.
import type { Store } from "../store/types";
import type { PlanEvent } from "./events";
import { posterKeys } from "./marketing-keys";
import { getPlanMeta, loadPlanEvents, readStoredPlanEvents } from "./store";

/** Whether a plan's poster and posts job is running now (it holds the plan's marketing lock). */
export async function marketingBusy(store: Store, runId: string): Promise<boolean> {
  try {
    return (await store.get(posterKeys.lock(runId))) !== null;
  } catch {
    return false;
  }
}

/** A stream never runs longer than this (the route's maxDuration is 300 s). */
export const PLAN_STREAM_MAX_MS = 280_000;

interface Progress {
  /** Marketing has started and not finished. */
  open: boolean;
  /** Marketing has finished. */
  done: boolean;
  /** When the latest event was written (its `at`), or null before any. */
  lastAt: number | null;
}

/** Marketing's progress and the latest write, after these events. */
function progressOf(events: readonly PlanEvent[], from: Progress = { open: false, done: false, lastAt: null }): Progress {
  let { open, done, lastAt } = from;
  for (const event of events) {
    if (event.type === "stage.started" && event.stage === "marketing") {
      open = true;
      done = false;
    }
    if (event.type === "stage.done" && event.stage === "marketing") {
      open = false;
      done = true;
    }
    const at = Date.parse(event.at);
    if (!Number.isNaN(at)) lastAt = Math.max(lastAt ?? at, at);
  }
  return { open, done, lastAt };
}

export type PlanStreamStatus = { status: "running" | "done" | "partial" | "failed" };

const encoder = new TextEncoder();
export const sseEvent = (event: PlanEvent) => `id: ${event.seq}\nevent: plan\ndata: ${JSON.stringify(event)}\n\n`;
export const sseStatus = (status: PlanStreamStatus) => `event: status\ndata: ${JSON.stringify(status)}\n\n`;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/** The seq a viewer already has, from `Last-Event-ID`; null when absent or not a seq. */
export function lastSeq(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,7}$/.test(value)) return null;
  return Number(value);
}

/** The list index after the event with this seq (seqs can land out of order). Unknown: start over. */
export function indexAfterSeq(events: readonly Pick<PlanEvent, "seq">[], seq: number | null): number {
  if (seq === null) return 0;
  const index = events.findIndex((e) => e.seq === seq);
  return index === -1 ? 0 : index + 1;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export interface PlanStreamOptions {
  lastEventId?: string | null;
  signal?: AbortSignal;
  /** How often the store is read while the plan runs. */
  pollMs?: number;
  /** How often it is read once the plan has ended (while marketing may still write). */
  idlePollMs?: number;
  heartbeatMs?: number;
  /** After the plan ends with no marketing under way, wait this long (from its end) for marketing to start. */
  lingerMs?: number;
  /** Marketing that wrote nothing for this long is taken as stuck, and the stream ends. */
  marketingQuietMs?: number;
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called once when the stream ends, however it ends (the route frees its stream lease). */
  onClose?: () => void | Promise<void>;
}

export function streamLivePlan(store: Store, runId: string, options: PlanStreamOptions = {}): ReadableStream<Uint8Array> {
  const pollMs = options.pollMs ?? 700;
  const idlePollMs = options.idlePollMs ?? 2_000;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const lingerMs = options.lingerMs ?? 15_000;
  const marketingQuietMs = options.marketingQuietMs ?? 90_000;
  const maxMs = options.maxMs ?? PLAN_STREAM_MAX_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const signal = options.signal;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.resolve(options.onClose?.()).catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const opened = now();
      let lastSent = opened;
      let status: PlanStreamStatus["status"] | null = null;
      let index = -1;
      let progress: Progress = { open: false, done: false, lastAt: null };
      send("retry: 3000\n\n");
      try {
        while (!closed && !signal?.aborted && now() - opened < maxMs) {
          const meta = await getPlanMeta(store, runId);
          if (!meta) {
            send(sseStatus({ status: "failed" }));
            break;
          }
          if (index === -1) {
            const all = await readStoredPlanEvents(store, runId);
            index = indexAfterSeq(all, lastSeq(options.lastEventId));
            progress = progressOf(all.slice(0, index));
          }
          // Events first, then the status they lead to: a viewer that stops at "done" has the whole plan.
          const events = await readStoredPlanEvents(store, runId, index);
          for (const event of events) send(sseEvent(event));
          if (events.length) {
            index += events.length;
            lastSent = now();
            progress = progressOf(events, progress);
          }
          if (status !== meta.status) {
            status = meta.status;
            send(sseStatus({ status }));
            lastSent = now();
          }
          const ended = meta.status !== "running";
          if (ended) {
            // When the latest thing happened: the plan's end, or a later write (marketing, a post).
            const endedAt = Date.parse(meta.updatedAt);
            const latest = Math.max(Number.isNaN(endedAt) ? opened : endedAt, progress.lastAt ?? 0);
            // Marketing done: nothing more is coming. Marketing under way (its events say so, or its job holds
            // the plan's lock before its first event): wait for it, unless it went quiet (a job that died).
            // Not started: wait a little after the latest write for it to start.
            if (progress.done && !progress.open) break;
            const making = progress.open || (await marketingBusy(store, runId));
            if (now() - latest >= (making ? marketingQuietMs : lingerMs)) break;
          }
          if (now() - lastSent >= heartbeatMs) {
            send(": still here\n\n");
            lastSent = now();
          }
          await sleep(ended ? idlePollMs : pollMs, signal);
        }
      } catch {
        // The store went away mid-stream: end it; the viewer reconnects from its last event.
      }
      await close();
      controller.close();
    },
    async cancel() {
      await close();
    },
  });
}

/** An example's events, replayed at a reading pace. Ends with its status. */
export function streamExamplePlan(events: readonly PlanEvent[], options: Pick<PlanStreamOptions, "lastEventId" | "signal" | "sleep" | "onClose"> & { paceMs?: number } = {}): ReadableStream<Uint8Array> {
  const sleep = options.sleep ?? wait;
  const pace = options.paceMs ?? 50;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.resolve(options.onClose?.()).catch(() => undefined);
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send("retry: 3000\n\n");
      send(sseStatus({ status: "running" }));
      for (const event of events.slice(indexAfterSeq(events, lastSeq(options.lastEventId)))) {
        if (closed || options.signal?.aborted) break;
        send(sseEvent(event));
        await sleep(pace, options.signal);
      }
      const partial = events.some((e) => e.type === "run.partial");
      if (!closed && !options.signal?.aborted) send(sseStatus({ status: partial ? "partial" : "done" }));
      await close();
      controller.close();
    },
    async cancel() {
      await close();
    },
  });
}

/** An example's events for the stream: its recording plus anything added in the store. */
export const examplePlanEvents = (store: Store | null, id: string) => loadPlanEvents(store, id);
