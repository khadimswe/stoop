"use client";

// A live run's report in the browser: GET /api/report/<id> first, then the run's event stream
// (SSE), reduced with the same reducer the server uses (lib/events.ts). A finished run streams from
// seq 0 so its state rebuilds, and frames and revisions that land after the run apply on top; a run
// still going shows its progress until it ends. The stream closes after a quiet while and the browser
// stops when the server answers 204; while a storyboard or a revision is pending, it reconnects from
// the last event it saw. The after-run actions (storyboards, "Not this vibe", Resume) post to their
// routes and show the API's plain answers, never an error screen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveActions, FramesNote, ReviseField, ReviseNote } from "@/components/stoop/report/revise/live-actions";
import type { ApiError, FramesResponse, ReviseResponse, RunStartResponse, StreamStatus } from "@/lib/api/responses";
import { initialState, reduce, runEventSchema, toReport, type ReportState, type RunEvent } from "@/lib/events";
import { reportSchema, type Report, type Stage } from "@/lib/report/schema";
import { revisionOutcome } from "@/lib/report/view/why";

export type LivePhase =
  | { kind: "loading" }
  /** Still going: the stage it is on and how many agent steps it has logged. */
  | { kind: "running"; stage: Stage | null; steps: number }
  /** Stopped before the end (the deadline, or its instance went away): Resume picks it up. */
  | { kind: "stopped" }
  | { kind: "done"; report: Report }
  | { kind: "unavailable"; reason: "not_found" | "failed" | "network"; message: string };

export interface ResumeState {
  state: "idle" | "sending" | "note";
  message: string | null;
  /** Set when the server answered with an example replay instead of a live run. */
  exampleHref: string | null;
}

const TERMINAL: readonly ReportState["status"][] = ["done", "partial", "failed"];
/** While something is pending, how long to wait before reconnecting a closed stream, and for how long to keep trying. */
const RECONNECT_MS = 4_000;
const RECONNECT_TRIES = 75;
const FLUSH_MS = 60;
/** A run that ended without a report the stream could build: ask the report route again, a few times. */
const REFETCH_MS = 1_500;
const REFETCH_TRIES = 3;

const NETWORK_MESSAGE = "Could not reach Stoop. Check your connection and try again.";
const SLOW_FRAMES = "The storyboard is taking longer than usual. Reload the page in a minute to see it.";
const SLOW_REVISION = "The revision is taking longer than usual. Reload the page in a minute to see it.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiMessage(body: unknown): string | null {
  const error = (body as Partial<ApiError> | null)?.error;
  return typeof error?.message === "string" ? error.message : null;
}

function isStatus(value: unknown): value is StreamStatus {
  const v = value as Partial<StreamStatus> | null;
  return !!v && typeof v.status === "string" && typeof v.attempt === "number" && typeof v.resumable === "boolean";
}

export function useLiveReport(runId: string) {
  const reportUrl = `/api/report/${runId}`;
  const eventsUrl = `/api/run/${runId}/events`;

  const [fetched, setFetched] = useState<{ kind: "loading" } | { kind: "done"; report: Report } | { kind: "running"; resumable: boolean } | Extract<LivePhase, { kind: "unavailable" }>>({ kind: "loading" });
  const [runState, setRunState] = useState<ReportState>(initialState);
  const [stream, setStream] = useState<StreamStatus | null>(null);
  const [frames, setFrames] = useState<Record<string, FramesNote & { key: string }>>({});
  const [revisions, setRevisions] = useState<Record<string, ReviseNote & { traceFrom: number }>>({});
  const [resume, setResume] = useState<ResumeState>({ state: "idle", message: null, exampleHref: null });
  const [attempt, setAttempt] = useState(0);
  const [reopen, setReopen] = useState(0);
  /** The stream stopped reconnecting while something was still pending: say so instead of waiting forever. */
  const [gaveUp, setGaveUp] = useState(false);

  const source = useRef<EventSource | null>(null);
  const lastId = useRef<string | null>(null);
  const queue = useRef<RunEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tries = useRef(0);
  const pending = useRef(false);
  /** False once the page is gone, so a request that answers late never opens a stream nothing will close. */
  const alive = useRef(true);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const batch = queue.current;
    queue.current = [];
    if (batch.length) setRunState((state) => reduce(batch, state));
  }, []);

  const close = useCallback(() => {
    source.current?.close();
    source.current = null;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
  }, []);

  const connect = useCallback(
    (from: string | null) => {
      close();
      const es = new EventSource(from ? `${eventsUrl}?lastEventId=${encodeURIComponent(from)}` : eventsUrl);
      source.current = es;
      es.addEventListener("run", (message) => {
        const event = message as MessageEvent<string>;
        if (event.lastEventId) lastId.current = event.lastEventId;
        let data: unknown;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        const parsed = runEventSchema.safeParse(data);
        if (!parsed.success) return;
        queue.current.push(parsed.data);
        flushTimer.current ??= setTimeout(flush, FLUSH_MS);
      });
      es.addEventListener("status", (message) => {
        let data: unknown;
        try {
          data = JSON.parse((message as MessageEvent<string>).data);
        } catch {
          return;
        }
        if (!isStatus(data)) return;
        // The events a status follows land in the same render as the status itself.
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flush();
        setStream(data);
      });
      es.onerror = () => {
        // CONNECTING: the browser retries on its own. CLOSED: the server said there is nothing new (204).
        if (es.readyState !== EventSource.CLOSED || source.current !== es) return;
        source.current = null;
        if (!pending.current) return;
        if (tries.current < RECONNECT_TRIES) {
          tries.current += 1;
          reconnectTimer.current = setTimeout(() => setReopen((n) => n + 1), RECONNECT_MS);
        } else setGaveUp(true);
      };
    },
    [close, eventsUrl, flush],
  );

  // A closed stream that still has something pending reopens from the last event it saw.
  useEffect(() => {
    if (reopen > 0 && !source.current) connect(lastId.current);
  }, [connect, reopen]);

  /** Opens the stream from where it left off, unless it is open already. */
  const follow = useCallback(() => {
    if (!alive.current) return;
    tries.current = 0;
    setGaveUp(false);
    if (!source.current) connect(lastId.current);
  }, [connect]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      close();
    };
  }, [close]);

  // The report, then the stream. `attempt` re-runs it (Retry).
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      let response: Response;
      try {
        response = await fetch(reportUrl, { cache: "no-store", signal: controller.signal });
      } catch {
        if (!controller.signal.aborted) setFetched({ kind: "unavailable", reason: "network", message: NETWORK_MESSAGE });
        return;
      }
      const body = (await readJson(response)) as { status?: string; report?: unknown; eventsUrl?: string | null; resumable?: boolean } | null;
      if (controller.signal.aborted) return;
      if (!response.ok || !body) {
        setFetched({ kind: "unavailable", reason: response.status === 404 ? "not_found" : "failed", message: apiMessage(body) ?? "This report could not be loaded right now." });
        return;
      }
      if (body.status === "done") {
        const parsed = reportSchema.safeParse(body.report);
        if (!parsed.success) {
          setFetched({ kind: "unavailable", reason: "failed", message: "This report could not be read." });
          return;
        }
        setFetched({ kind: "done", report: parsed.data });
        // Frames and revisions still arrive on the run's stream: replay it from the start.
        if (body.eventsUrl) connect(null);
        return;
      }
      if (body.status === "running") {
        setFetched({ kind: "running", resumable: body.resumable === true });
        if (!body.resumable) connect(null);
        return;
      }
      setFetched({ kind: "unavailable", reason: "failed", message: "This report could not be read." });
    })();
    return () => {
      controller.abort();
      close();
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      queue.current = [];
    };
  }, [attempt, close, connect, reportUrl]);

  // The streamed run as a Report, once it has ended: it carries every frame and revision that landed since.
  const streamed = useMemo(() => {
    if (!runState.runId || !TERMINAL.includes(runState.status)) return null;
    try {
      return toReport(runState);
    } catch {
      return null;
    }
  }, [runState]);

  const report = streamed ?? (fetched.kind === "done" ? fetched.report : null);

  const phase: LivePhase = useMemo(() => {
    if (report) return { kind: "done", report };
    if (fetched.kind === "loading") return { kind: "loading" };
    if (fetched.kind === "unavailable") return fetched;
    if (stream?.status === "stopped" || (fetched.kind === "running" && fetched.resumable && runState.runId === null)) return { kind: "stopped" };
    return { kind: "running", stage: runState.stage, steps: runState.trace.length };
  }, [fetched, report, runState.runId, runState.stage, runState.trace.length, stream?.status]);

  // A run that ended without a report the stream could build (or that the stream says failed): ask the
  // report route again, which answers with the stored report.
  const ended = TERMINAL.includes(runState.status) || stream?.status === "done" || stream?.status === "failed";
  const refetches = useRef(0);
  useEffect(() => {
    if (report || fetched.kind !== "running" || !ended || refetches.current >= REFETCH_TRIES) return;
    refetches.current += 1;
    const timer = setTimeout(() => setAttempt((n) => n + 1), REFETCH_MS);
    return () => clearTimeout(timer);
  }, [ended, fetched.kind, report]);

  // The notes as the page shows them, read against the report: a storyboard request's note gives way
  // once its job's own event lands, and a revision is done (or failed) once the report says so.
  const shownFrames = useMemo(() => {
    const shown: Record<string, FramesNote> = {};
    for (const [segmentId, note] of Object.entries(frames)) {
      const world = report?.worlds.find((w) => w.segmentId === segmentId);
      if (note.state === "starting" && world && JSON.stringify(world.frames) !== note.key) continue;
      shown[segmentId] = gaveUp && note.state === "starting" ? { state: "note", message: SLOW_FRAMES } : { state: note.state, message: note.message };
    }
    if (gaveUp) {
      for (const world of report?.worlds ?? []) {
        if (world.frames?.status === "rendering" && !shown[world.segmentId]) shown[world.segmentId] = { state: "note", message: SLOW_FRAMES };
      }
    }
    return shown;
  }, [frames, gaveUp, report]);

  const shownRevisions = useMemo(() => {
    const shown: Record<string, ReviseNote> = {};
    for (const [segmentId, note] of Object.entries(revisions)) {
      const outcome = note.state === "revising" && report ? revisionOutcome(report, segmentId, note.revisionId, note.traceFrom) : null;
      const stale = gaveUp && note.state === "revising" && outcome?.status === "pending";
      shown[segmentId] = {
        field: note.field,
        revisionId: note.revisionId,
        state: outcome?.status === "done" ? "done" : outcome?.status === "failed" ? "failed" : stale ? "note" : note.state,
        message: outcome?.status === "failed" ? outcome.reason : stale ? SLOW_REVISION : note.message,
      };
    }
    return shown;
  }, [gaveUp, report, revisions]);

  // While a storyboard or a revision is pending, a closed stream reconnects.
  useEffect(() => {
    const rendering = report?.worlds.some((w) => w.frames?.status === "rendering") ?? false;
    pending.current =
      rendering ||
      Object.values(shownFrames).some((n) => n.state === "starting" || n.state === "sending") ||
      Object.values(shownRevisions).some((n) => n.state === "revising" || n.state === "sending");
  }, [report, shownFrames, shownRevisions]);

  const requestFrames = useCallback(
    async (segmentId: string) => {
      const world = report?.worlds.find((w) => w.segmentId === segmentId);
      const key = JSON.stringify(world?.frames ?? null);
      setFrames((notes) => ({ ...notes, [segmentId]: { state: "sending", message: null, key } }));
      let response: Response;
      try {
        response = await fetch(`/api/frames/${runId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ segmentId }) });
      } catch {
        setFrames((notes) => ({ ...notes, [segmentId]: { state: "note", message: NETWORK_MESSAGE, key } }));
        return;
      }
      const body = (await readJson(response)) as Partial<FramesResponse> | null;
      if (!response.ok || !body?.status) {
        setFrames((notes) => ({ ...notes, [segmentId]: { state: "note", message: apiMessage(body) ?? "Storyboards could not start right now.", key } }));
        return;
      }
      if (body.status === "paused") {
        setFrames((notes) => ({ ...notes, [segmentId]: { state: "note", message: body.message ?? "Storyboards paused today.", key } }));
        return;
      }
      setFrames((notes) => ({ ...notes, [segmentId]: { state: "starting", message: null, key } }));
      pending.current = true;
      follow();
    },
    [follow, report, runId],
  );

  const requestRevision = useCallback(
    async ({ segmentId, field, reason }: { segmentId: string; field: ReviseField; reason: string }) => {
      const traceFrom = report?.trace.length ?? 0;
      const base = { field, revisionId: null, traceFrom };
      setRevisions((notes) => ({ ...notes, [segmentId]: { ...base, state: "sending", message: null } }));
      let response: Response;
      try {
        response = await fetch("/api/revise", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId, segmentId, field, exclude: [], reason }),
        });
      } catch {
        setRevisions((notes) => ({ ...notes, [segmentId]: { ...base, state: "note", message: NETWORK_MESSAGE } }));
        return { ok: true, message: NETWORK_MESSAGE };
      }
      const body = (await readJson(response)) as Partial<ReviseResponse> | null;
      if (!response.ok || !body?.status) {
        const message = apiMessage(body) ?? "The revision could not start right now.";
        const code = (body as Partial<ApiError> | null)?.error?.code;
        // A note the guardrails refused: say why next to the note, so it can be changed and sent again.
        if (code === "invalid") {
          setRevisions((notes) => {
            const next = { ...notes };
            delete next[segmentId];
            return next;
          });
          return { ok: false, message };
        }
        setRevisions((notes) => ({ ...notes, [segmentId]: { ...base, state: "note", message } }));
        return { ok: true, message };
      }
      if (body.status === "capped") {
        const message = body.message ?? "This run has used its revisions.";
        setRevisions((notes) => ({ ...notes, [segmentId]: { ...base, state: "note", message } }));
        return { ok: true, message };
      }
      setRevisions((notes) => ({ ...notes, [segmentId]: { ...base, revisionId: body.revisionId ?? null, state: "revising", message: null } }));
      pending.current = true;
      follow();
      return { ok: true, message: null };
    },
    [follow, report, runId],
  );

  const onResume = useCallback(async () => {
    setResume({ state: "sending", message: null, exampleHref: null });
    let response: Response;
    try {
      response = await fetch(`/api/run/${runId}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      setResume({ state: "note", message: NETWORK_MESSAGE, exampleHref: null });
      return;
    }
    const body = (await readJson(response)) as Partial<RunStartResponse> | null;
    if (!response.ok || !body?.mode) {
      setResume({ state: "note", message: apiMessage(body) ?? "The run could not resume right now. Try again in a minute.", exampleHref: null });
      return;
    }
    if (body.mode === "example") {
      setResume({ state: "note", message: body.message ?? "Live runs are off right now.", exampleHref: body.slug ? `/examples/${body.slug}` : null });
      return;
    }
    if (!alive.current) return;
    // The next attempt streams again from seq 0: start the state over and follow it.
    setResume({ state: "idle", message: null, exampleHref: null });
    setStream(null);
    setRunState(initialState);
    lastId.current = null;
    setFetched({ kind: "running", resumable: false });
    connect(null);
  }, [connect, runId]);

  const retry = useCallback(() => {
    refetches.current = 0;
    setGaveUp(false);
    setFetched({ kind: "loading" });
    setRunState(initialState);
    setStream(null);
    lastId.current = null;
    setAttempt((n) => n + 1);
  }, []);

  const actions: LiveActions = useMemo(
    () => ({
      runId,
      frames: shownFrames,
      revisions: shownRevisions,
      requestFrames,
      requestRevision,
    }),
    [requestFrames, requestRevision, runId, shownFrames, shownRevisions],
  );

  return { phase, resume, onResume, retry, actions };
}
