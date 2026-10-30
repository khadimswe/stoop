// A plan's server-sent event stream. Live plans: the plan's list in the store, from where the viewer
// left off (`Last-Event-ID` is the last seq it has), plus a status message whenever the plan's status
// changes. Examples: the recorded run (and anything added to it since), paced so it reads like a run.
// Marketing events that land after the plan keep coming for a while; then the stream ends and the
// viewer can reconnect. Every event is a PlanEvent, so one reducer (reducePlan) reads them all.
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
  pollMs?: number;
  heartbeatMs?: number;
  /** After the plan ends, keep the stream open this long for marketing events. */
  lingerMs?: number;
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function streamLivePlan(store: Store, runId: string, options: PlanStreamOptions = {}): ReadableStream<Uint8Array> {
  const pollMs = options.pollMs ?? 700;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const lingerMs = options.lingerMs ?? 30_000;
  const maxMs = options.maxMs ?? 280_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const signal = options.signal;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const opened = now();
      let lastSent = opened;
      let status: PlanStreamStatus["status"] | null = null;
      let index = -1;
      let quietSince: number | null = null;
      send("retry: 3000\n\n");
      try {
        while (!signal?.aborted && now() - opened < maxMs) {
          const meta = await getPlanMeta(store, runId);
          if (!meta) {
            send(sseStatus({ status: "failed" }));
            break;
          }
          if (index === -1) index = indexAfterSeq(await readStoredPlanEvents(store, runId), lastSeq(options.lastEventId));
          // Events first, then the status they lead to: a viewer that stops at "done" has the whole plan.
          const events = await readStoredPlanEvents(store, runId, index);
          for (const event of events) send(sseEvent(event));
          if (events.length) {
            index += events.length;
            lastSent = now();
            quietSince = null;
          }
          if (status !== meta.status) {
            status = meta.status;
            send(sseStatus({ status }));
            lastSent = now();
          }
          if (meta.status !== "running") {
            // While the poster and posts are being made (their job holds the lock), the stream stays open for them.
            if (await marketingBusy(store, runId)) quietSince = null;
            else {
              quietSince ??= now();
              if (now() - quietSince >= lingerMs) break;
            }
          }
          if (now() - lastSent >= heartbeatMs) {
            send(": still here\n\n");
            lastSent = now();
          }
          await sleep(pollMs, signal);
        }
      } catch {
        // The store went away mid-stream: end it; the viewer reconnects from its last event.
      }
      controller.close();
    },
  });
}

/** An example's events, replayed at a reading pace. Ends with its status. */
export function streamExamplePlan(events: readonly PlanEvent[], options: Pick<PlanStreamOptions, "lastEventId" | "signal" | "sleep"> & { paceMs?: number } = {}): ReadableStream<Uint8Array> {
  const sleep = options.sleep ?? wait;
  const pace = options.paceMs ?? 50;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send("retry: 3000\n\n");
      send(sseStatus({ status: "running" }));
      for (const event of events.slice(indexAfterSeq(events, lastSeq(options.lastEventId)))) {
        if (options.signal?.aborted) break;
        send(sseEvent(event));
        await sleep(pace, options.signal);
      }
      const partial = events.some((e) => e.type === "run.partial");
      if (!options.signal?.aborted) send(sseStatus({ status: partial ? "partial" : "done" }));
      controller.close();
    },
  });
}

/** An example's events for the stream: its recording plus anything added in the store. */
export const examplePlanEvents = (store: Store | null, id: string) => loadPlanEvents(store, id);
