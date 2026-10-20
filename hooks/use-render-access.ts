import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RenderAccessResponse } from "@/lib/api/responses";
import { JUDGE_HINT_COOKIE } from "@/lib/judge/constants";
import { DEFAULT_DRAFT_SECONDS, DRAFT_SECONDS_RANGE } from "@/lib/render/draft";
import type { RenderStatus, RenderTarget, VideoAccess } from "@/lib/render/schema";

// The report's video line, on the client. Example pages are static, so who the visitor is (a judge
// pass, a BYOK visitor, a spent budget) is only known after mount: GET /api/render/access answers per
// world, and a judge draft goes through POST /api/render and GET /api/render/[jobId].
//
// The pure parts (fetchRenderAccess, startDraft, pollDraft) take their fetch and sleep as arguments,
// so lib/report/view/output.test.ts covers them with a mocked fetch. Types come from the contract
// modules with `import type` only: those modules pull in zod and the Report schema.

export const OFF_ACCESS: RenderAccessResponse = { video: "off", rendersLeft: null, byok: false };

/**
 * True when the page carries the judge pass hint cookie ("1"). A hint for the banner only, never a
 * credential: the access answer decides what the pass unlocks. The httpOnly credential is never read.
 */
export function hasJudgeHint(cookie: string): boolean {
  return cookie.split(/;\s*/).some((pair) => pair === `${JUDGE_HINT_COOKIE}=1`);
}

const VIDEO: Record<VideoAccess, true> = { judge: true, byok: true, "budget-used": true, off: true };
const JOB_STATUS: Record<RenderStatus["status"], true> = { queued: true, rendering: true, done: true, failed: true };
const JOB_ID = /^rj_[0-9a-f]{24}$/;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const browserFetch: Fetch = (input, init) => fetch(input, init);

export function accessUrl(target: RenderTarget): string {
  return `/api/render/access?${new URLSearchParams({ reportId: target.reportId, segment: target.segment })}`;
}

/** The BYOK page: a full page load (its own CSP), opened in a new tab. */
export function byokHref(target: RenderTarget): string {
  return `/byok?${new URLSearchParams({ reportId: target.reportId, segment: target.segment })}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** renderAccessResponseSchema, checked by hand so the client bundle stays free of the schema modules. */
export function parseAccess(body: unknown): RenderAccessResponse | null {
  if (!isRecord(body)) return null;
  const { video, rendersLeft, byok, draftSeconds } = body;
  if (typeof video !== "string" || !(video in VIDEO)) return null;
  if (rendersLeft !== null && !(typeof rendersLeft === "number" && Number.isInteger(rendersLeft) && rendersLeft >= 0)) return null;
  if (typeof byok !== "boolean") return null;
  const access: RenderAccessResponse = { video: video as VideoAccess, rendersLeft, byok };
  // Optional: an answer without it (or with a length out of range) reads as the shared default.
  if (typeof draftSeconds === "number" && Number.isInteger(draftSeconds) && draftSeconds >= DRAFT_SECONDS_RANGE.min && draftSeconds <= DRAFT_SECONDS_RANGE.max) {
    access.draftSeconds = draftSeconds;
  }
  return access;
}

/** The draft's length as this visitor's access answer says it, or the length the server defaults to. */
export function draftSecondsOf(access: Pick<RenderAccessResponse, "draftSeconds"> | null): number {
  return access?.draftSeconds ?? DEFAULT_DRAFT_SECONDS;
}

/** A draft's video lives on Stoop's public storage: an https URL, never anything else. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** renderStatusResponseSchema's `job`, checked by hand. */
export function parseJob(body: unknown): RenderStatus | null {
  const job = isRecord(body) ? body.job : null;
  if (!isRecord(job)) return null;
  const { id, target, status, videoUrl, reason, cached } = job;
  if (typeof id !== "string" || !JOB_ID.test(id)) return null;
  if (typeof status !== "string" || !(status in JOB_STATUS)) return null;
  if (!isRecord(target) || typeof target.reportId !== "string" || typeof target.segment !== "string") return null;
  const url = videoUrl === null ? null : httpsUrl(videoUrl);
  if (videoUrl !== null && url === null) return null;
  if (status === "done" && url === null) return null;
  return {
    id,
    target: { reportId: target.reportId, segment: target.segment },
    status: status as RenderStatus["status"],
    videoUrl: url,
    reason: typeof reason === "string" ? reason : null,
    cached: cached === true,
  };
}

/** What this visitor may do. Any error, a missing route or a malformed answer reads as "off", quietly. */
export async function fetchRenderAccess(target: RenderTarget, fetchImpl: Fetch = browserFetch): Promise<RenderAccessResponse> {
  try {
    const res = await fetchImpl(accessUrl(target), { cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) return OFF_ACCESS;
    return parseAccess(await res.json()) ?? OFF_ACCESS;
  } catch {
    return OFF_ACCESS;
  }
}

export type StartResult =
  | { kind: "job"; job: RenderStatus }
  /** The pass, the IP or the day's server budget is spent. */
  | { kind: "budget-used" }
  /** No server draft for this visitor (an expired pass, or drafts switched off): the access line decides again. */
  | { kind: "off" }
  /** `retry`: whether trying again now could help (not while an earlier try may still be rendering). */
  | { kind: "error"; message: string; retry: boolean };

const START_FAILED = "The draft didn't start. Try again in a minute.";

/** Starts a server-paid judge draft. The server builds the prompt from the report's own pack. */
export async function startDraft(target: RenderTarget, fetchImpl: Fetch = browserFetch): Promise<StartResult> {
  let res: Response;
  try {
    res = await fetchImpl("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ target }),
    });
  } catch {
    return { kind: "error", message: START_FAILED, retry: true };
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const job = parseJob(body);
    return job ? { kind: "job", job } : { kind: "error", message: START_FAILED, retry: true };
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  // A spent counter (pass, network, day or total) is the budget; a burst of requests is not.
  if (error?.code === "daily_cap") return { kind: "budget-used" };
  if (error?.code === "off") return { kind: "off" };
  if (error?.code === "rate_limited") return { kind: "error", message: "Too many tries just now. Try again in a minute.", retry: true };
  // "busy": an earlier try at this exact draft may still be rendering, so trying again now cannot help.
  if (error?.code === "busy") {
    const message = typeof error.message === "string" && error.message.length <= 300 ? error.message : "An earlier try at this draft may still be rendering. Try again later.";
    return { kind: "error", message, retry: false };
  }
  return { kind: "error", message: START_FAILED, retry: true };
}

/** Retry-After in milliseconds (seconds, or an HTTP date), or null. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Resolves when the page is visible again (at once when it is, or outside a browser), or on abort. */
function whenVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    const onChange = () => {
      if (!document.hidden) done();
    };
    document.addEventListener("visibilitychange", onChange);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export type PollResult =
  | { kind: "settled"; job: RenderStatus }
  /** The server does not know this job (404): an old or malformed id. Stop asking. */
  | { kind: "missing" }
  | { kind: "timeout" }
  | { kind: "aborted" };

export interface PollOptions {
  fetchImpl?: Fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Between checks while they succeed. */
  intervalMs?: number;
  /** The longest wait after failed checks (the wait doubles per failure in a row). */
  maxIntervalMs?: number;
  /** Stop checking after this long; the job keeps going on the server. */
  timeoutMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  onUpdate?: (job: RenderStatus) => void;
  /** Resolves when checking may go on: the page is visible again. Defaults to the document's visibility. */
  visible?: (signal?: AbortSignal) => Promise<void>;
}

/** Resolves after `ms`, or at once when the signal aborts. */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Checks a draft until it is done or failed, pausing while the page is hidden. A failed check
 * (network, a 5xx, a 429, a malformed answer) is retried after a wait that doubles per failure in a
 * row, up to maxIntervalMs, or after the server's Retry-After when it sends one. A 404 (the server
 * does not know the job) ends it, and so do the timeout and the signal.
 */
export async function pollDraft(jobId: string, options: PollOptions = {}): Promise<PollResult> {
  const {
    fetchImpl = browserFetch,
    sleep = wait,
    intervalMs = 5_000,
    maxIntervalMs = 60_000,
    timeoutMs = 10 * 60_000,
    now = Date.now,
    signal,
    onUpdate,
    visible = whenVisible,
  } = options;
  if (!JOB_ID.test(jobId)) return { kind: "missing" };
  const deadline = now() + timeoutMs;
  let failures = 0;
  while (now() < deadline) {
    await visible(signal);
    if (signal?.aborted) return { kind: "aborted" };
    let delay = intervalMs;
    try {
      const res = await fetchImpl(`/api/render/${jobId}`, { cache: "no-store", headers: { accept: "application/json" }, signal });
      if (res.status === 404) return { kind: "missing" };
      const job = res.ok ? parseJob(await res.json()) : null;
      if (job) {
        failures = 0;
        onUpdate?.(job);
        if (job.status === "done" || job.status === "failed") return { kind: "settled", job };
      } else {
        failures += 1;
        delay = Math.min(maxIntervalMs, intervalMs * 2 ** failures);
        const asked = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers.get("retry-after"), now()) : null;
        if (asked !== null) delay = Math.min(maxIntervalMs, Math.max(intervalMs, asked));
      }
    } catch {
      if (signal?.aborted) return { kind: "aborted" };
      failures += 1;
      delay = Math.min(maxIntervalMs, intervalMs * 2 ** failures);
    }
    await sleep(delay, signal);
  }
  return { kind: "timeout" };
}

// --- The shared access store ---------------------------------------------------------------------
// One answer per report and world, shared by every component that asks (the judge banner and the
// top world's video line ask the same question). A pass's drafts are counted per pass, not per world,
// so a draft that settles in any world refreshes every world of that report, the banner included.

export type AccessState = { status: "loading" } | { status: "ready"; access: RenderAccessResponse };

interface Entry {
  state: AccessState;
  listeners: Set<() => void>;
  /** The request in flight, so a second ask joins it. */
  loading: Promise<void> | null;
  /** A fresh ask made while a request was in flight: it asks again once that one lands. */
  next: Promise<void> | null;
}

const LOADING: AccessState = { status: "loading" };
const store = new Map<string, Entry>();
const keyOf = (target: RenderTarget) => `${target.reportId}|${target.segment}`;

function entryFor(key: string): Entry {
  let entry = store.get(key);
  if (!entry) {
    entry = { state: LOADING, listeners: new Set(), loading: null, next: null };
    store.set(key, entry);
  }
  return entry;
}

/**
 * Asks for one report and world. A plain ask joins a request already in flight. A `fresh` ask (after
 * a draft settles) never trusts a request sent before it: it asks again once that one lands, so the
 * drafts left on screen are never older than the draft.
 */
export function loadAccess(target: RenderTarget, fetchImpl: Fetch = browserFetch, fresh = false): Promise<void> {
  const entry = entryFor(keyOf(target));
  if (entry.loading) {
    if (!fresh) return entry.loading;
    entry.next ??= entry.loading.then(() => {
      entry.next = null;
      return loadAccess(target, fetchImpl);
    });
    return entry.next;
  }
  entry.loading = fetchRenderAccess(target, fetchImpl).then((access) => {
    entry.loading = null;
    entry.state = { status: "ready", access };
    for (const listener of entry.listeners) listener();
  });
  return entry.loading;
}

/**
 * Asks again for every world of a report this page has asked about: after a draft settles anywhere,
 * the pass's drafts left change for all of them. Resolves when every answer is in.
 */
export function refreshReportAccess(reportId: string, fetchImpl: Fetch = browserFetch): Promise<void> {
  const loads = [...store.keys()]
    .filter((key) => key.startsWith(`${reportId}|`))
    .map((key) => loadAccess({ reportId, segment: key.slice(reportId.length + 1) }, fetchImpl, true));
  return Promise.all(loads).then(() => undefined);
}

/** The current answer for one report and world, as the hook reads it. Reading never asks. */
export function accessStateOf(target: RenderTarget): AccessState {
  return store.get(keyOf(target))?.state ?? LOADING;
}

/** Asks once per report and world; `refresh` asks again for the whole report (after a draft, the renders left change). */
export function useRenderAccess(target: RenderTarget | null): { state: AccessState; refresh: () => void } {
  // The target arrives as a fresh object each render; its two strings are what identify it.
  const reportId = target?.reportId ?? null;
  const segment = target?.segment ?? null;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (reportId === null || segment === null) return () => {};
      const entry = entryFor(keyOf({ reportId, segment }));
      entry.listeners.add(onChange);
      if (entry.state.status === "loading") void loadAccess({ reportId, segment });
      return () => {
        entry.listeners.delete(onChange);
      };
    },
    [reportId, segment],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (reportId === null || segment === null ? LOADING : entryFor(keyOf({ reportId, segment })).state),
    () => LOADING,
  );
  const refresh = useCallback(() => {
    if (reportId !== null) void refreshReportAccess(reportId);
  }, [reportId]);
  return { state, refresh };
}

// --- One judge draft -----------------------------------------------------------------------------

export type DraftState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "rendering"; jobId: string; startedAt: number }
  | { phase: "done"; videoUrl: string; cached: boolean }
  | { phase: "failed" }
  | { phase: "budget-used" }
  | { phase: "timeout" }
  /** `retry`: whether "Try the draft again" can help (not while an earlier try may still be rendering). */
  | { phase: "error"; message: string; retry: boolean };

/** This tab's note of a world's draft job, so a reload picks it up again. Storage may be unavailable. */
const draftKey = (reportId: string, segment: string) => `stoop:draft:${reportId}:${segment}`;

interface SavedDraft {
  jobId: string;
  /** When the draft started, so a resumed timer keeps counting from there. */
  startedAt: number;
}

function remember(key: string, draft: SavedDraft | null) {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // Private mode or blocked storage: a reload just starts over.
  }
}

function recall(key: string): SavedDraft | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!isRecord(value) || typeof value.jobId !== "string" || !JOB_ID.test(value.jobId) || typeof value.startedAt !== "number") return null;
    return { jobId: value.jobId, startedAt: value.startedAt };
  } catch {
    return null;
  }
}

/**
 * Starts and follows one server-paid draft for a world. `onSettled` refreshes the access line. The
 * job id is kept for this tab, so a reload resumes following it (a finished one shows again at once;
 * one the server no longer knows is forgotten quietly).
 */
export function useDraftRender(target: RenderTarget, onSettled: () => void): { state: DraftState; start: () => void } {
  const [state, setState] = useState<DraftState>({ phase: "idle" });
  const abort = useRef<AbortController | null>(null);
  // False once the component is gone, so a start that answers late never begins polling.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);
  const { reportId, segment } = target;
  const key = draftKey(reportId, segment);

  const follow = useCallback(
    async (jobId: string, resumed: { startedAt: number } | null) => {
      if (!alive.current) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const startedAt = resumed?.startedAt ?? Date.now();
      remember(key, { jobId, startedAt });
      setState({ phase: "rendering", jobId, startedAt });
      const result = await pollDraft(jobId, { signal: controller.signal });
      if (result.kind === "aborted" || !alive.current) return;
      if (result.kind === "missing") {
        remember(key, null);
        setState(resumed ? { phase: "idle" } : { phase: "failed" });
      } else if (result.kind === "timeout") setState({ phase: "timeout" });
      else if (result.job.status === "done" && result.job.videoUrl) setState({ phase: "done", videoUrl: result.job.videoUrl, cached: result.job.cached });
      else {
        remember(key, null);
        setState({ phase: "failed" });
      }
      onSettled();
    },
    [key, onSettled],
  );

  // A draft this tab started before a reload, picked up after mount (the server render knows nothing of it).
  useEffect(() => {
    const saved = recall(key);
    if (saved) void Promise.resolve().then(() => follow(saved.jobId, { startedAt: saved.startedAt }));
  }, [key, follow]);

  const start = useCallback(() => {
    setState({ phase: "starting" });
    void startDraft({ reportId, segment }).then((result) => {
      if (!alive.current) return;
      if (result.kind === "job") {
        const { job } = result;
        if (job.status === "done" && job.videoUrl) {
          remember(key, { jobId: job.id, startedAt: Date.now() });
          setState({ phase: "done", videoUrl: job.videoUrl, cached: job.cached });
          onSettled();
        } else if (job.status === "failed") {
          setState({ phase: "failed" });
          onSettled();
        } else void follow(job.id, null);
        return;
      }
      if (result.kind === "error") setState({ phase: "error", message: result.message, retry: result.retry });
      else if (result.kind === "off") {
        // No server draft for this visitor after all (an expired pass): the refreshed access line decides,
        // which offers BYOK when it is on.
        setState({ phase: "idle" });
        onSettled();
      } else {
        setState({ phase: "budget-used" });
        onSettled();
      }
    });
  }, [reportId, segment, key, follow, onSettled]);

  return { state, start };
}
