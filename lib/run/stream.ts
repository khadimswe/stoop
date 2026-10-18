// Following a run's server-sent events in the browser: one EventSource, reduced with the shared
// reducer (lib/events.ts), so a live run, a resumed run and an example replay build the same state.
//
// - Duplicates never apply twice: the reducer skips any seq it has seen, so a reconnect is harmless.
// - Reloads resume: the applied events are kept in sessionStorage, and the next page asks the stream
//   for what came after them (`?lastEventId=attempt:seq`; EventSource sends the Last-Event-ID header
//   on its own reconnects).
// - The browser reconnects by itself after a dropped connection. When it gives up (an HTTP error, or
//   204 for a stream that has ended), one plain fetch reads the status: 204 means ended, 404 means
//   the run expired, anything else is retried with backoff, then reported plainly.
// - The stream's status message says when a run stopped and can be resumed (the Resume button).
//
// Framework-free, with its vendors passed in, so tests drive it with a fake EventSource.
import { eventId } from "../api/requests";
import type { ReportResponse, RUN_META_STATUSES, StreamStatus } from "../api/responses";
import type { ExampleSlug } from "../demo/examples";
import { apply, initialState, runEventSchema, type ReportState, type RunEvent } from "../events";
import { hasEnded } from "./rail";
import type { KeyValueStore } from "./recents";
import { callApi, exampleSlugOf, postResume, readApiError, singleFlight, type ReplayReason } from "./start";

/** What the controller needs from EventSource (the DOM class satisfies it). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface RunStreamDeps {
  createSource(url: string): EventSourceLike;
  fetch: typeof fetch;
  /** sessionStorage, or null where it is unavailable (nothing persists then). */
  storage: KeyValueStore | null;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

export interface Problem {
  /** expired: the run is gone (404). unavailable: the server keeps refusing. lost: the network keeps failing. */
  kind: "expired" | "unavailable" | "lost";
  message: string;
}

export interface RunSnapshot {
  runId: string;
  state: ReportState;
  /** The events applied to `state`, for the current attempt, in order (the progress rail reads them). */
  events: readonly RunEvent[];
  connection: Connection;
  /** The stream's last status message, if any. */
  stream: StreamStatus | null;
  problem: Problem | null;
  /** This browser's clock when the first event arrived (an example replay's timer). */
  openedAt: number | null;
  /** This browser's clock when the run ended in view. */
  endedAt: number | null;
  /** Reconnects in a row without a new event. */
  retries: number;
}

export type ResumeOutcome = { kind: "live" } | { kind: "example"; slug: ExampleSlug; reason: ReplayReason } | { kind: "error"; message: string };

export interface RunStream {
  start(): void;
  stop(): void;
  /** Writes what arrived to storage now (the page is being hidden or unloaded). */
  flush(): void;
  /** Reconnects at once, after the stream was lost. */
  retry(): void;
  /** POST /api/run/[id]/resume, then follows the new attempt. One call at a time. */
  resume(): Promise<ResumeOutcome>;
  snapshot(): RunSnapshot;
}

/** Waits between reconnects after the browser gave up; then the problem is shown with a Try again button. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
/** Persisting is throttled: a run sends a burst of events at once. */
export const PERSIST_MS = 500;
const PERSIST_VERSION = 1;
const CLOSED = 2;
const LOST = "Lost the connection to this run. It keeps going on our side.";
const STATUSES: readonly string[] = ["running", "stopped", "done", "failed"] satisfies (typeof RUN_META_STATUSES)[number][];

export const persistKey = (runId: string) => `stoop:run:${runId}`;
export const eventsUrlFor = (runId: string) => `/api/run/${encodeURIComponent(runId)}/events`;

export function emptySnapshot(runId: string): RunSnapshot {
  return { runId, state: initialState, events: [], connection: "connecting", stream: null, problem: null, openedAt: null, endedAt: null, retries: 0 };
}

/** One SSE `run` message, checked against the event schema; anything else is ignored. */
export function parseRunEvent(data: unknown): RunEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = runEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One SSE `status` message. */
export function parseStreamStatus(data: unknown): StreamStatus | null {
  if (typeof data !== "string") return null;
  try {
    const value = JSON.parse(data) as Partial<StreamStatus> | null;
    if (!value || typeof value.status !== "string" || !STATUSES.includes(value.status)) return null;
    if (typeof value.attempt !== "number" || !Number.isInteger(value.attempt) || value.attempt < 1 || typeof value.resumable !== "boolean") return null;
    return { status: value.status, attempt: value.attempt, resumable: value.resumable };
  } catch {
    return null;
  }
}

/** Folds events into a state, keeping only the ones that changed it (a resumed attempt starts the list over). */
export function foldEvents(events: readonly RunEvent[], from: { state: ReportState; events: readonly RunEvent[] } = { state: initialState, events: [] }) {
  let state = from.state;
  let applied = [...from.events];
  for (const event of events) {
    const next = apply(state, event);
    if (next === state) continue;
    applied = next.attempt !== state.attempt ? [event] : [...applied, event];
    state = next;
  }
  return { state, events: applied };
}

export function createRunStream(runId: string, deps: RunStreamDeps, onChange: (snapshot: RunSnapshot) => void, options: { eventsUrl?: string } = {}): RunStream {
  const url = options.eventsUrl ?? eventsUrlFor(runId);
  const isExample = exampleSlugOf(runId) !== null;
  let snap = emptySnapshot(runId);
  let source: EventSourceLike | null = null;
  let retryTimer: unknown = null;
  let persistTimer: unknown = null;
  let stopped = false;
  /** Bumped by every connect and stop, so callbacks from an older connection do nothing. */
  let epoch = 0;

  const emit = (patch: Partial<RunSnapshot>) => {
    snap = { ...snap, ...patch };
    onChange(snap);
  };

  const lastId = () => (snap.state.runId && snap.state.lastSeq >= 0 ? eventId(snap.state.attempt, snap.state.lastSeq) : null);
  const withLast = (base: string, last: string | null) => (last ? `${base}${base.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(last)}` : base);

  function clearPersisted() {
    try {
      deps.storage?.removeItem(persistKey(runId));
    } catch {
      // Storage refused: nothing to clear.
    }
  }

  function persistNow() {
    if (persistTimer !== null) deps.clearTimer(persistTimer);
    persistTimer = null;
    if (!deps.storage || !snap.state.runId) return;
    // A finished example is cleared, so opening it again replays it from the start.
    if (isExample && hasEnded(snap.state)) return clearPersisted();
    try {
      deps.storage.setItem(persistKey(runId), JSON.stringify({ v: PERSIST_VERSION, events: snap.events, openedAt: snap.openedAt, endedAt: snap.endedAt }));
    } catch {
      // Full or blocked storage: a reload then replays the stream from the start, still without duplicates.
    }
  }

  function schedulePersist() {
    if (!deps.storage || persistTimer !== null) return;
    persistTimer = deps.setTimer(() => {
      persistTimer = null;
      persistNow();
    }, PERSIST_MS);
  }

  function restore() {
    let raw: string | null = null;
    try {
      raw = deps.storage?.getItem(persistKey(runId)) ?? null;
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { v?: unknown; events?: unknown; openedAt?: unknown; endedAt?: unknown } | null;
      if (!saved || saved.v !== PERSIST_VERSION || !Array.isArray(saved.events)) return;
      const events = saved.events.flatMap((item) => {
        const parsed = runEventSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
      const folded = foldEvents(events);
      // Another run's events under this key are never shown.
      if (folded.state.runId !== runId) return clearPersisted();
      snap = {
        ...snap,
        ...folded,
        openedAt: typeof saved.openedAt === "number" ? saved.openedAt : null,
        endedAt: typeof saved.endedAt === "number" && hasEnded(folded.state) ? saved.endedAt : null,
      };
    } catch {
      clearPersisted();
    }
  }

  function closeSource() {
    source?.close();
    source = null;
  }

  function connect() {
    if (stopped) return;
    closeSource();
    const mine = ++epoch;
    const es = deps.createSource(withLast(url, lastId()));
    source = es;
    emit({ connection: snap.retries > 0 ? "reconnecting" : "connecting" });
    es.addEventListener("open", () => {
      if (mine === epoch) emit({ connection: "open" });
    });
    es.addEventListener("run", (event) => {
      if (mine === epoch) onRun(event.data);
    });
    es.addEventListener("status", (event) => {
      if (mine === epoch) onStatus(event.data);
    });
    es.addEventListener("error", () => {
      if (mine !== epoch || stopped) return;
      // Still connecting: the browser retries by itself, sending Last-Event-ID.
      if (es.readyState !== CLOSED) return emit({ connection: "reconnecting" });
      void diagnose(mine);
    });
  }

  function onRun(data: unknown) {
    const event = parseRunEvent(data);
    if (!event) return;
    const before = snap.state;
    const folded = foldEvents([event], snap);
    if (folded.state === before) return;
    const ended = hasEnded(folded.state);
    const freshAttempt = folded.state.attempt !== before.attempt;
    emit({
      ...folded,
      retries: 0,
      problem: null,
      openedAt: snap.openedAt ?? deps.now(),
      endedAt: ended ? ((freshAttempt ? null : snap.endedAt) ?? deps.now()) : null,
    });
    if (ended) persistNow();
    else schedulePersist();
  }

  function onStatus(data: unknown) {
    const status = parseStreamStatus(data);
    if (!status) return;
    const over = status.status !== "running";
    // Stopped, done or failed: the server ends the stream, so it is closed here before the browser reconnects.
    if (over) {
      epoch++;
      closeSource();
    }
    const finished = status.status === "done" || status.status === "failed";
    emit({ stream: status, connection: over ? "closed" : snap.connection, endedAt: finished ? (snap.endedAt ?? deps.now()) : snap.endedAt });
    if (over) persistNow();
  }

  async function diagnose(mine: number) {
    closeSource();
    const last = lastId();
    let response: Response | null = null;
    try {
      response = await deps.fetch(withLast(url, last), { headers: { accept: "text/event-stream", ...(last ? { "last-event-id": last } : {}) }, cache: "no-store" });
    } catch {
      response = null;
    }
    if (stopped || mine !== epoch) {
      void response?.body?.cancel().catch(() => undefined);
      return;
    }
    if (!response) return retryLater(null);
    if (response.status === 204) {
      // The stream has ended and this view already holds its last event. The server says 204 for
      // any run that is not running, so a run whose events never said how it ended asks the report.
      if (!hasEnded(snap.state) && !isExample) return settleEnded(mine);
      emit({ connection: "closed", endedAt: snap.endedAt ?? deps.now() });
      return persistNow();
    }
    if (response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return retryLater(null);
    }
    const error = readApiError(response.status, await response.json().catch(() => null));
    if (stopped || mine !== epoch) return;
    if (response.status === 404 || response.status === 400) {
      clearPersisted();
      return emit({ connection: "closed", problem: { kind: "expired", message: error.message } });
    }
    retryLater(error.message);
  }

  /**
   * A live run that ended without saying how (it stopped at its deadline, or its instance died): GET
   * /api/report/[id] says whether it is resumable (stopped) or finished. The status then reads as if
   * the stream had sent it, so the Resume button shows after a reload too.
   */
  async function settleEnded(mine: number) {
    const result = await callApi<ReportResponse>(deps.fetch, `/api/report/${encodeURIComponent(runId)}`, { method: "GET" });
    if (stopped || mine !== epoch) return;
    if (!result.ok) {
      if (result.status === 404) {
        clearPersisted();
        return emit({ connection: "closed", problem: { kind: "expired", message: result.message } });
      }
      return retryLater(result.code === "network" ? null : result.message);
    }
    const attempt = snap.state.attempt;
    const status: StreamStatus =
      result.data.status === "running"
        ? { status: result.data.resumable ? "stopped" : "running", attempt, resumable: result.data.resumable }
        : { status: result.data.report.meta.provenance === "partial" ? "failed" : "done", attempt, resumable: false };
    // Still running after all (its status changed in between): follow it again.
    if (status.status === "running") return retryLater(null);
    emit({ stream: status, connection: "closed", endedAt: status.status === "stopped" ? snap.endedAt : (snap.endedAt ?? deps.now()) });
    persistNow();
  }

  /** The next reconnect, after its backoff; past the last one, the problem is shown. */
  function retryLater(serverMessage: string | null) {
    if (snap.retries >= BACKOFF_MS.length) {
      return emit({ connection: "closed", problem: serverMessage ? { kind: "unavailable", message: serverMessage } : { kind: "lost", message: LOST } });
    }
    const delay = BACKOFF_MS[snap.retries];
    emit({ connection: "reconnecting", retries: snap.retries + 1 });
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function cancelRetry() {
    if (retryTimer !== null) deps.clearTimer(retryTimer);
    retryTimer = null;
  }

  const resume = singleFlight(async (): Promise<ResumeOutcome> => {
    const result = await postResume(deps.fetch, runId);
    if (!result.ok) return { kind: "error", message: result.message };
    const reply = result.data;
    if (reply.mode === "example") return { kind: "example", slug: reply.slug, reason: reply.reason };
    if (stopped) return { kind: "live" };
    cancelRetry();
    // The next attempt streams again from seq 0; its first event starts a fresh state.
    emit({ stream: null, problem: null, retries: 0, endedAt: null });
    connect();
    return { kind: "live" };
  });

  return {
    start() {
      if (stopped) return;
      restore();
      if (hasEnded(snap.state)) return emit({ connection: "closed" });
      connect();
    },
    stop() {
      stopped = true;
      epoch++;
      cancelRetry();
      closeSource();
      persistNow();
    },
    flush: persistNow,
    retry() {
      if (stopped) return;
      cancelRetry();
      emit({ retries: 0, problem: null });
      connect();
    },
    resume,
    snapshot: () => snap,
  };
}
