// Server-paid draft renders (judges only): the render cache, the caps, the fal job and its finish.
//
//   1. The render cache by inputHash (keys.render.cache) answers first: a finished draft of the exact
//      same inputs comes back at no cost and reserves nothing ("Rendered earlier from this exact
//      prompt"). The same key holds a "pending" marker while a render runs, taken with SET NX, so two
//      requests for the same draft (a double click, two judges) share one render.
//   2. Every cap is reserved before anything is spent, one INCR each, and given back on overflow:
//      the pass (3), the IP for the day (6), the day (RENDERS_DAILY_CAP) and the lifetime total
//      (RENDERS_TOTAL_CAP). A counter is never left above its cap. A judge who clears cookies and opens
//      the judge link again gets a new pass, so the per-pass count starts over; the per-IP, daily and
//      lifetime caps still bound what any number of passes can spend.
//   3. fal's queue takes the job with Stoop's key. A refusal before fal accepts it gives every counter
//      back (the job records the IP and day it counted against); once fal may have accepted it, nothing
//      is given back, since fal may bill it, and the job is never failed or freed because a later store
//      write failed: the pending marker stays, so the same inputs cannot be billed twice.
//   4. Status polls and an after() poller advance the job: the result must come from fal's media
//      hosts, is downloaded under a size cap, and is stored on Stoop's public storage (fal's URLs
//      expire). The draft's URL lands on the job and in the render cache.
// falRequestId, passId and the visitor never leave the server (toRenderStatus drops them).
import { z } from "zod";
import { isFalMedia } from "../media/frames";
import { draftUsd } from "../prompts/models.config";
import { randomHex } from "../sign";
import type { Storage } from "../storage";
import { dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import type { VisitorId } from "../store/visitor";
import { sha256 } from "../hash";
import { falInputFor, QueueError, refused, videoModelFor, type VideoQueue } from "./fal";
import { renderJobIdSchema, renderJobSchema, type RenderJob, type RenderPlan } from "./schema";

if (typeof window !== "undefined") {
  throw new Error("lib/render/jobs runs on the server only.");
}

export const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
/** Waits between tries to save fal's request id after fal took a job (the store hiccupped). */
export const SAVE_BACKOFF_MS = [200, 1_000, 3_000] as const;
/** A job with no fal request id this long after it started never reached fal, or Stoop lost track of it. */
export const UNSUBMITTED_MS = 5 * 60_000;
/** A job still not stored this long after it started ends, whatever kept failing. */
export const MAX_FINISH_MS = 2 * 60 * 60_000;
/** The pending marker outlives the longest a job may keep trying (plus margin), so the same inputs never render twice meanwhile. */
export const PENDING_SECONDS = MAX_FINISH_MS / 1000 + 10 * 60;
const VIDEO_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

export interface RenderCaps {
  /** RENDERS_DAILY_CAP. */
  daily: number;
  /** RENDERS_TOTAL_CAP. */
  total: number;
  perPass: number;
  perIpDaily: number;
}

export interface RenderEnv {
  store: Store;
  /** Public storage, for the finished draft. */
  storage: Storage;
  queue: VideoQueue;
  caps: RenderCaps;
  now?: () => number;
  /** Downloads the result (tests pass a fake). */
  fetch?: typeof fetch;
  newJobId?: () => string;
  /** Waits between save retries (tests pass one that returns at once). */
  sleep?: (ms: number) => Promise<void>;
}

// --- Caps -------------------------------------------------------------------------------------------

export const COUNTER_NAMES = ["pass", "ip", "day", "total"] as const;
export type CounterName = (typeof COUNTER_NAMES)[number];

export interface Counter {
  name: CounterName;
  key: string;
  cap: number;
  ttlSeconds: number;
}

/** The four counters a server-paid draft is reserved against. */
export function renderCounters(owner: { passId: string; visitor: string; day: string }, caps: RenderCaps): Counter[] {
  return [
    { name: "pass", key: keys.render.pass(owner.passId), cap: caps.perPass, ttlSeconds: TTL.judging },
    { name: "ip", key: keys.rate("render", owner.visitor as VisitorId, owner.day), cap: caps.perIpDaily, ttlSeconds: TTL.daily },
    { name: "day", key: keys.daily("renders", owner.day), cap: caps.daily, ttlSeconds: TTL.daily },
    { name: "total", key: keys.render.total, cap: caps.total, ttlSeconds: TTL.judging },
  ];
}

/** Takes one from every counter, or none: an overflow gives back what this call took and names the full counter. */
export async function reserveAll(store: Store, counters: readonly Counter[]): Promise<{ ok: true } | { ok: false; full: CounterName }> {
  const taken: Counter[] = [];
  for (const counter of counters) {
    const after = await store.incr(counter.key, { ttlSeconds: counter.ttlSeconds });
    taken.push(counter);
    if (after > counter.cap) {
      await giveBackAll(store, taken);
      return { ok: false, full: counter.name };
    }
  }
  return { ok: true };
}

/** Gives one back to every counter. The TTL only applies if a counter expired in between, so a stray -1 still expires. */
export async function giveBackAll(store: Store, counters: readonly Counter[]): Promise<void> {
  await Promise.all(counters.map((counter) => store.incr(counter.key, { by: -1, ttlSeconds: counter.ttlSeconds })));
}

/** What each counter has used, without counting anything. */
export async function counterUsage(store: Store, counters: readonly Counter[]): Promise<Record<CounterName, number>> {
  const used = await Promise.all(counters.map(async (counter) => [counter.name, Math.max(0, (await store.get<number>(counter.key)) ?? 0)] as const));
  return Object.fromEntries(used) as Record<CounterName, number>;
}

/** Drafts left: the tightest counter's room. */
export function renderRoom(counters: readonly Counter[], used: Record<CounterName, number>): number {
  return Math.max(0, Math.min(...counters.map((counter) => counter.cap - used[counter.name])));
}

// --- Jobs and the render cache -------------------------------------------------------------------------

const httpsUrl = z.url({ protocol: /^https$/ });
const cacheEntrySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending"), jobId: renderJobIdSchema }),
  z.strictObject({ state: z.literal("done"), jobId: renderJobIdSchema, videoUrl: httpsUrl, at: z.iso.datetime() }),
]);
type CacheEntry = z.infer<typeof cacheEntrySchema>;

/** The pending marker, built the same way every time so a compare-and-delete finds it. */
const pendingMarker = (jobId: string): CacheEntry => ({ state: "pending", jobId });

export const isTerminal = (job: RenderJob) => job.status === "done" || job.status === "failed";

/** Ended without a request id while counted: fal may have taken it, so its inputs stay held. */
export const mayStillBeOnFal = (job: RenderJob) => job.status === "failed" && job.charged && job.falRequestId === null;

export const LOST_REASON = "The draft never reached fal, or Stoop lost track of it. The same draft can be tried again in about two hours.";

export async function loadJob(store: Store, jobId: string): Promise<RenderJob | null> {
  if (!renderJobIdSchema.safeParse(jobId).success) return null;
  const parsed = renderJobSchema.safeParse(await store.get(keys.render.job(jobId)));
  return parsed.success ? parsed.data : null;
}

async function saveJob(store: Store, job: RenderJob): Promise<RenderJob> {
  const valid = renderJobSchema.parse(job);
  await store.set(keys.render.job(valid.id), valid, { ttlSeconds: TTL.renderJob });
  await store.set(keys.render.latest(valid.target.reportId, valid.target.segment), valid.id, { ttlSeconds: TTL.renderJob });
  return valid;
}

async function readCache(store: Store, inputHash: string): Promise<CacheEntry | null> {
  const parsed = cacheEntrySchema.safeParse(await store.get(keys.render.cache(inputHash)));
  return parsed.success ? parsed.data : null;
}

/** A hash of the pass for fal's end_user_id: it ties a render to a pass without naming anyone. */
export const endUserId = (passId: string) => `stoop-${sha256(`stoop-judge-pass:${passId}`).slice(0, 32)}`;

export interface StartInput {
  plan: RenderPlan;
  passId: string;
  visitor: VisitorId;
}

export type StartOutcome =
  /** A new render, accepted by fal. */
  | { kind: "started"; job: RenderJob }
  /** The same inputs rendered before: free, not counted. */
  | { kind: "cached"; job: RenderJob }
  /** The same inputs are rendering right now: this request follows that job. */
  | { kind: "joined"; job: RenderJob }
  /** A cap is spent; nothing was reserved. */
  | { kind: "capped"; full: CounterName }
  /** An earlier try at these inputs may still be on fal (Stoop lost track of it): nothing new starts until its marker expires. */
  | { kind: "held"; job: RenderJob }
  /** fal did not take the job (refunded when it surely refused). */
  | { kind: "failed"; job: RenderJob };

export async function startRender(env: RenderEnv, input: StartInput): Promise<StartOutcome> {
  const { store } = env;
  const now = env.now ?? Date.now;
  const { plan } = input;
  const cacheKey = keys.render.cache(plan.inputHash);
  const stamp = () => new Date(now()).toISOString();
  const day = dayOf(now());
  const base = {
    target: plan.target,
    endpoint: plan.endpoint,
    inputHash: plan.inputHash,
    passId: input.passId,
    visitor: input.visitor,
    day,
    durationSeconds: plan.durationSeconds,
  };

  // An earlier render, or one running now, answers first and costs nothing.
  const fromCache = async (entry: CacheEntry): Promise<StartOutcome | null> => {
    if (entry.state === "done") {
      const at = stamp();
      const job: RenderJob = { ...base, id: env.newJobId?.() ?? `rj_${randomHex(12)}`, charged: false, falRequestId: null, status: "done", videoUrl: entry.videoUrl, reason: null, cached: true, usd: 0, createdAt: at, updatedAt: at };
      return { kind: "cached", job: await saveJob(store, job) };
    }
    const running = await loadJob(store, entry.jobId);
    if (running && running.status !== "failed") return { kind: "joined", job: running };
    // A job fal may hold without Stoop knowing its request id keeps its inputs until the marker expires.
    if (running && mayStillBeOnFal(running)) return { kind: "held", job: running };
    // A marker whose job surely failed, or vanished, frees the inputs.
    await store.deleteIfEquals(cacheKey, pendingMarker(entry.jobId));
    return null;
  };

  const falInput = falInputFor(plan, { endUserId: endUserId(input.passId) });
  const counters = renderCounters({ passId: input.passId, visitor: input.visitor, day }, env.caps);
  const id = env.newJobId?.() ?? `rj_${randomHex(12)}`;
  const at = stamp();
  const queued: RenderJob = { ...base, id, charged: true, falRequestId: null, status: "queued", videoUrl: null, reason: null, cached: false, usd: null, createdAt: at, updatedAt: at };
  // The order matters for two requests racing on the same inputs: the job record exists before its
  // marker does (so whoever sees the marker can follow the job), and the caps are reserved before the
  // marker is claimed (so a marker always belongs to a job that may spend). The loser gives back.
  let claimed = false;
  for (let round = 0; round < 3 && !claimed; round++) {
    const entry = await readCache(store, plan.inputHash);
    if (entry) {
      const answered = await fromCache(entry);
      if (answered) return answered;
    }
    await store.set(keys.render.job(id), renderJobSchema.parse(queued), { ttlSeconds: TTL.renderJob });
    const reserved = await reserveAll(store, counters);
    if (!reserved.ok) {
      await store.del(keys.render.job(id));
      // The cap may only look spent because another request for these inputs holds a reservation.
      const other = await readCache(store, plan.inputHash);
      const answered = other ? await fromCache(other) : null;
      return answered ?? { kind: "capped", full: reserved.full };
    }
    claimed = await store.set(cacheKey, pendingMarker(id), { ifAbsent: true, ttlSeconds: PENDING_SECONDS });
    if (!claimed) {
      await giveBackAll(store, counters);
      await store.del(keys.render.job(id));
    }
  }
  if (!claimed) throw new Error("The render cache kept changing; try again.");

  const job = await saveJob(store, queued);
  let requestId: string;
  try {
    ({ requestId } = await env.queue.submit(plan.endpoint, falInput));
  } catch (error) {
    const surelyRefused = error instanceof QueueError ? !error.accepted : false;
    // A sure refusal gives every counter back; an unknown outcome stays counted (fal may bill it).
    if (surelyRefused) await giveBackAll(store, counters);
    const reason = error instanceof QueueError ? error.message : "The draft could not be started.";
    const failed = await saveJob(store, { ...job, status: "failed", charged: !surelyRefused, reason, updatedAt: stamp() });
    // Only a sure refusal frees the inputs; otherwise fal may be rendering them, and the marker stays.
    if (surelyRefused) await store.deleteIfEquals(cacheKey, pendingMarker(id));
    return { kind: "failed", job: failed };
  }

  // fal took the job. From here on it is never refunded, failed or freed for a store hiccup: the request
  // id is saved with retries, and if the store still refuses, the job stays as it is (its marker too).
  const accepted: RenderJob = { ...job, falRequestId: requestId, updatedAt: stamp() };
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return { kind: "started", job: await saveJob(store, accepted) };
    } catch (error) {
      if (attempt >= SAVE_BACKOFF_MS.length) {
        console.error(`Draft render ${job.id}: fal took it, but its request id could not be saved (${error instanceof Error ? error.name : "error"}). Its marker stays, so these inputs are not billed twice.`);
        return { kind: "started", job: accepted };
      }
      await sleep(SAVE_BACKOFF_MS[attempt]);
    }
  }
}

// --- Advancing a job ------------------------------------------------------------------------------

const falVideoOutput = z.object({ video: z.object({ url: httpsUrl, content_type: z.string().optional() }).loose() }).loose();

/** A download that did not work. `lasting` failures (wrong type, too large, empty, a 4xx) end the job; the rest are tried again. */
class DownloadError extends Error {
  constructor(
    message: string,
    readonly lasting: boolean,
  ) {
    super(message);
  }
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new DownloadError("The draft is larger than Stoop keeps.", true);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

async function download(env: RenderEnv, url: string, declaredType: string | undefined, signal: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string }> {
  let response: Response;
  try {
    response = await (env.fetch ?? globalThis.fetch)(url, { redirect: "error", signal });
  } catch (error) {
    throw new DownloadError(`The draft could not be downloaded: ${error instanceof Error ? error.name : "network error"}.`, false);
  }
  const served = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!response.ok) throw new DownloadError(`The draft could not be downloaded (HTTP ${response.status}).`, refused(response.status));
  const declared = declaredType?.split(";")[0].trim().toLowerCase() ?? "";
  // fal's media hosts sometimes serve octet-stream; its own answer names the type then.
  const contentType = VIDEO_TYPES[served] ? served : served === "application/octet-stream" && VIDEO_TYPES[declared] ? declared : "";
  if (!contentType) throw new DownloadError(`The draft could not be downloaded (HTTP ${response.status}, ${served || "no type"}).`, true);
  if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) throw new DownloadError("The draft is larger than Stoop keeps.", true);
  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response, MAX_VIDEO_BYTES);
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    throw new DownloadError(`The draft could not be downloaded: ${error instanceof Error ? error.name : "network error"}.`, false);
  }
  if (bytes.byteLength === 0) throw new DownloadError("The draft came back empty.", true);
  return { bytes, contentType };
}

export interface AdvanceOptions {
  abortSignal?: AbortSignal;
  /** Write updatedAt even when nothing changed, so status polls know a poller is on it. */
  touch?: boolean;
}

/** Marks a job's poll time without changing anything else: status polls then leave it to whoever touched it. */
export async function touchRender(store: Store, jobId: string, now: number = Date.now()): Promise<void> {
  // Read fresh: a job another checker finished meanwhile is left as it is.
  const current = await loadJob(store, jobId);
  if (!current || isTerminal(current)) return;
  await store.set(keys.render.job(jobId), renderJobSchema.parse({ ...current, updatedAt: new Date(now).toISOString() }), { ttlSeconds: TTL.renderJob });
}

/**
 * Checks a job on fal once and moves it along: queued, rendering, then done (stored) or failed. Only a
 * lasting failure ends a job (fal refusing it, an answer without a video or off its media hosts, a
 * download of the wrong type or size); a timeout, a network error or a 5xx is tried again on the next
 * check, until the job is MAX_FINISH_MS old. A finished job is never overwritten: two checkers racing
 * (the after() poller and a status poll) both end on "done" once either stored the draft.
 */
export async function advanceRender(env: RenderEnv, jobId: string, options: AdvanceOptions = {}): Promise<RenderJob | null> {
  const { store } = env;
  const now = env.now ?? Date.now;
  const job = await loadJob(store, jobId);
  if (!job || isTerminal(job)) return job;
  const opts = options.abortSignal ? { abortSignal: options.abortSignal } : {};
  const cacheKey = keys.render.cache(job.inputHash);
  // Every write reads the job fresh, and only "done" may replace a finished job: a slower checker's
  // touch, status change or failure never puts a stored draft back to rendering or failed.
  const save = async (next: Partial<RenderJob>) => {
    const current = (await loadJob(store, job.id)) ?? job;
    if (isTerminal(current) && next.status !== "done") return current;
    return saveJob(store, { ...current, ...next, updatedAt: new Date(now()).toISOString() });
  };
  const finishedElsewhere = async (): Promise<RenderJob | null> => {
    const entry = await readCache(store, job.inputHash);
    return entry?.state === "done" && entry.jobId === job.id ? save({ status: "done", videoUrl: entry.videoUrl, reason: null, usd: draftUsd(videoModelFor(job.endpoint), job.durationSeconds) }) : null;
  };
  /** Ends the job. `free` lets the same inputs render again now; a job fal may still hold keeps its marker until it expires. */
  const fail = async (reason: string, { free = true }: { free?: boolean } = {}) => {
    const current = await loadJob(store, job.id);
    if (current && isTerminal(current)) return current;
    const failed = await save({ status: "failed", reason: reason.slice(0, 300) });
    // Another checker may have stored the draft meanwhile: its result wins.
    const done = await finishedElsewhere();
    if (done) return done;
    if (free) await store.deleteIfEquals(cacheKey, pendingMarker(job.id));
    return failed;
  };
  /** A failure worth another try: keep the job as it is, unless it has been finishing for too long. */
  const later = async (reason: string) => (now() - Date.parse(job.createdAt) > MAX_FINISH_MS ? fail(reason) : options.touch ? save({}) : job);

  if (!job.falRequestId) {
    // The start died between reserving and hearing back from fal, or fal took it and the request id
    // could not be saved: end it rather than leave it queued forever. Nothing is given back and the
    // marker stays until it expires, since fal may be rendering (and billing) these inputs.
    return now() - Date.parse(job.createdAt) > UNSUBMITTED_MS ? fail(LOST_REASON, { free: false }) : job;
  }
  const requestId = job.falRequestId;

  let state;
  try {
    state = await env.queue.status(job.endpoint, requestId, opts);
  } catch (error) {
    // fal saying it does not know the request (a 4xx other than 408 and 429) means it will never finish.
    if (error instanceof QueueError && refused(error.status) && error.status !== 429) return fail(`${error.message} The draft was not found on fal.`);
    return later("fal stopped answering about this draft.");
  }
  if (state !== "COMPLETED") {
    const status = state === "IN_PROGRESS" ? "rendering" : "queued";
    return status !== job.status || options.touch ? save({ status }) : job;
  }

  let data: unknown;
  try {
    data = await env.queue.result(job.endpoint, requestId, opts);
  } catch (error) {
    if (error instanceof QueueError && refused(error.status) && error.status !== 429) return fail(error.message);
    return later(error instanceof QueueError ? error.message : "fal's result could not be read.");
  }
  const output = falVideoOutput.safeParse(data);
  if (!output.success) return fail("fal answered without a video.");
  const { url, content_type: declared } = output.data.video;
  if (!isFalMedia(url)) return fail("fal answered with a video outside its own media hosts.");
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let video: { bytes: Uint8Array; contentType: string };
  try {
    video = await download(env, url, declared, options.abortSignal ? AbortSignal.any([timeout, options.abortSignal]) : timeout);
  } catch (error) {
    if (error instanceof DownloadError && error.lasting) return fail(error.message);
    return later(error instanceof Error ? error.message : "The draft could not be downloaded.");
  }
  let stored: { url: string };
  try {
    stored = await env.storage.put(`renders/${job.inputHash}.${VIDEO_TYPES[video.contentType]}`, video.bytes, video.contentType, opts);
  } catch {
    return later("The draft could not be stored.");
  }
  const done = await save({ status: "done", videoUrl: stored.url, reason: null, usd: draftUsd(videoModelFor(job.endpoint), job.durationSeconds) });
  await store.set(cacheKey, { state: "done", jobId: job.id, videoUrl: stored.url, at: done.updatedAt } satisfies CacheEntry, { ttlSeconds: TTL.renderCache });
  // A late failure from another checker may have landed between the two writes: done wins.
  const current = await loadJob(store, job.id);
  return current?.status === "failed" ? saveJob(store, { ...done, updatedAt: new Date(now()).toISOString() }) : done;
}

export interface PollOptions {
  /** Epoch ms to stop by (the route's time limit, with room to spare). */
  deadline: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  abortSignal?: AbortSignal;
}

/** The after() poller: advances the job until it ends or the deadline nears; status polls take over after that. */
export async function pollRender(env: RenderEnv, jobId: string, options: PollOptions): Promise<RenderJob | null> {
  const now = env.now ?? Date.now;
  const interval = options.intervalMs ?? 5_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    const job = await advanceRender(env, jobId, { touch: true, ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}) });
    if (!job || isTerminal(job) || now() + interval >= options.deadline) return job;
    await sleep(interval);
  }
}

/**
 * A status poll advances a job only when no poller has touched it for this long: longer than a download
 * may take, so a status poll never starts a second one beside a live poller.
 */
export const STALE_MS = 75_000;
export const isStale = (job: RenderJob, now: number) => now - Date.parse(job.updatedAt) > STALE_MS;
