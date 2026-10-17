// The run's server-sent event stream. Live runs: the current attempt's list in the store, from where
// the viewer left off (`Last-Event-ID` is "attempt:seq"), plus a status message whenever the run's
// status changes (stopped runs offer Resume). Examples: their recorded trace, paced so it reads like a
// run. Frames and revisions that land after the run keep coming for a while; then the stream ends and
// the viewer can reconnect.
import { lastEventIdSchema, eventId } from "../api/requests";
import type { StreamStatus } from "../api/responses";
import type { RunEvent } from "../events";
import { getRunMeta, indexAfter, liveStatus, readRunEvents } from "../store/runs";
import type { Store } from "../store/types";

export interface StreamOptions {
  lastEventId?: string | null;
  signal?: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
  /** After the run ended, keep the stream open this long for frames and revisions. */
  lingerMs?: number;
  /** The whole stream, inside the route's max duration; the viewer reconnects after. */
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const encoder = new TextEncoder();
export const sseEvent = (event: RunEvent) => `id: ${eventId(event.attempt ?? 1, event.seq)}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`;
export const sseStatus = (status: StreamStatus) => `event: status\ndata: ${JSON.stringify(status)}\n\n`;

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

function lastSeen(value: string | null | undefined) {
  const parsed = value ? lastEventIdSchema.safeParse(value) : null;
  return parsed?.success ? parsed.data : null;
}

export function streamLiveRun(store: Store, runId: string, options: StreamOptions = {}): ReadableStream<Uint8Array> {
  const pollMs = options.pollMs ?? 750;
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
      let status: StreamStatus | null = null;
      let attempt = 0;
      let index = 0;
      let quietSince: number | null = null;
      const seen = lastSeen(options.lastEventId);
      send("retry: 3000\n\n");
      try {
        while (!signal?.aborted && now() - opened < maxMs) {
          const meta = await getRunMeta(store, runId);
          if (!meta) {
            send(sseStatus({ status: "failed", attempt: Math.max(attempt, 1), resumable: false }));
            break;
          }
          if (meta.attempt !== attempt) {
            // A new attempt starts over at seq 0; the viewer's state resets on its first event.
            const fresh = attempt === 0 && seen?.attempt === meta.attempt;
            attempt = meta.attempt;
            index = fresh ? indexAfter(await readRunEvents(store, runId, attempt), seen.seq) : 0;
          }
          // Events first, then the status they lead to: a viewer that stops at "done" has the whole run.
          const events = await readRunEvents(store, runId, attempt, index);
          for (const event of events) send(sseEvent(event));
          if (events.length) {
            index += events.length;
            lastSent = now();
            quietSince = null;
          }
          // A run still marked running whose lease is gone lost its instance: it shows as stopped, resumable.
          const current = await liveStatus(store, meta, now());
          const next: StreamStatus = { status: current, attempt, resumable: current === "stopped" };
          if (!status || status.status !== next.status || status.attempt !== next.attempt) {
            status = next;
            send(sseStatus(next));
            lastSent = now();
          }
          if (current === "stopped") break;
          if (current === "done" || current === "failed") {
            quietSince ??= now();
            if (now() - quietSince >= lingerMs) break;
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

/** An example's recorded trace, replayed at a reading pace. Ends with the done status. */
export function streamExample(events: readonly RunEvent[], options: Pick<StreamOptions, "lastEventId" | "signal" | "sleep"> & { paceMs?: number } = {}): ReadableStream<Uint8Array> {
  const sleep = options.sleep ?? wait;
  const pace = options.paceMs ?? 60;
  const seen = lastSeen(options.lastEventId);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send("retry: 3000\n\n");
      send(sseStatus({ status: "running", attempt: 1, resumable: false }));
      const from = seen ? indexAfter(events, seen.seq) : 0;
      for (const event of events.slice(from)) {
        if (options.signal?.aborted) break;
        send(sseEvent(event));
        await sleep(pace, options.signal);
      }
      if (!options.signal?.aborted) send(sseStatus({ status: "done", attempt: 1, resumable: false }));
      controller.close();
    },
  });
}
