// Storyboard frames: the cheap draft a live run renders before any video, as its own invocation
// (POST /api/frames/<id>) or pipelined by the runtime as each world's pack lands. Per world, 4 stills
// of the kept concept at 9:16 (lib/prompts/frames.ts), on fal: the edit model with the product's own
// photo as the reference when it has one, the fast text model otherwise (models.config.ts
// FRAME_MODELS). Then the critique loop (lib/stages/critique.ts): Claude reviews the frames with
// vision, and each kept rewrite re-renders once, at most 4 per world. Zero Qloo calls.
//
// Spend is guarded three ways:
//   a lock per world and attempt (keys.run.framesLock), so repeated requests cannot render twice
//   the global FRAMES_DAILY_CAP, reserved before rendering; only fresh renders count, and what a job
//     did not use (a failure, a cap overflow) is given back
//   a render cache by prompt hash (keys.frames.render), so a repeat render (a resumed run, a second
//     request) is free and not counted
// Bytes go to storage through lib/storage.ts; the store keeps each frame's URL by prompt hash.
import { createFalClient, type FalClient } from "@fal-ai/client";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { framesRequestSchema, liveRunIdSchema } from "../api/requests";
import { framesResponseSchema, type FramesResponse } from "../api/responses";
import { dailyCaps } from "../config";
import { checkText, FAMOUS_PLACES } from "../guardrails";
import { apiError, type RouteAnswer } from "../route-answer";
import type { BriefSlots, ProductSpec } from "../prompts/brief";
import { buildFramePrompt, FRAME_ASPECT, frameScenes, type FramePrompt } from "../prompts/frames";
import { FRAME_MODELS, type FrameModel } from "../prompts/models.config";
import type { ProductionPack } from "../prompts/pack";
import type { RunEventInput } from "../events";
import type { Frame, World, WorldFrames } from "../report/world";
import { dayOf, keys, TTL } from "../store/keys";
import { appendRunEvents, getRunMeta, refreshReport } from "../store/runs";
import type { Store } from "../store/types";
import type { Storage } from "../storage";
import { addRunCost, countingModel, emptyDelta, reportNames, runState, type CostDelta } from "../stages/after-run";
import { critiqueFrames, frameChecklist, type CritiqueResult } from "../stages/critique";
import { visitorId } from "../store/visitor";

if (typeof window !== "undefined") {
  throw new Error("lib/media/frames runs on the server only.");
}

/** The lock outlives the route's 300 s limit, so a crashed job frees its world within minutes. */
export const FRAMES_LOCK_SECONDS = 10 * 60;
export const PAUSED_REASON = "Storyboards paused today.";
export const NO_SERVICE_REASON = "Storyboards are not set up on this server.";
/** A failure that would only repeat: the route never starts it again. */
export const BLOCKED_REASON = "Every frame prompt broke the guardrails.";
export const FRAME_RENDER_TIMEOUT_MS = 90_000;
export const FRAME_MAX_BYTES = 15 * 1024 * 1024;

// --- The renderer ------------------------------------------------------------------------------------

export interface FrameRequest {
  model: FrameModel;
  prompt: string;
  /** Product photos the edit model takes as references (empty for the text model). */
  referenceUrls: readonly string[];
}

export interface RenderedImage {
  bytes: Uint8Array;
  contentType: string;
}

/** Renders one frame. Tests pass their own; the app uses fal. */
export interface FrameRenderer {
  render(request: FrameRequest, options?: { abortSignal?: AbortSignal }): Promise<RenderedImage>;
}

/**
 * A frame that did not come back. `billed` says whether the vendor may still charge for it (it
 * accepted the job, or produced an image that could not be fetched): a billed failure keeps its place
 * in the daily cap, so a broken download or store can never turn into unbounded renders.
 */
export class FrameRenderError extends Error {
  readonly billed: boolean;
  constructor(message: string, options: { billed?: boolean } = {}) {
    super(message);
    this.name = "FrameRenderError";
    this.billed = options.billed ?? false;
  }
}

/** Unknown errors (a store or storage write after the render, a deadline) count as billed. */
export const wasBilled = (error: unknown) => (error instanceof FrameRenderError ? error.billed : true);

/** Where fal serves its outputs. Anything else in its answer is never fetched. */
export function isFalMedia(url: string): boolean {
  const { protocol, hostname, pathname } = new URL(url);
  if (protocol !== "https:") return false;
  return /^(?:[a-z0-9-]+\.)*fal\.media$/.test(hostname) || (hostname === "storage.googleapis.com" && pathname.startsWith("/falserverless/"));
}

/** Reads a body up to `max` bytes and stops there, whatever its content-length said. */
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
      await reader.cancel();
      throw new FrameRenderError("The rendered frame is too large.", { billed: true });
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

/** What fal is sent for one frame: 9:16, one image, at the cheap draft settings. */
export function falInput(request: FrameRequest): Record<string, unknown> {
  if (request.model.role === "edit") {
    return { prompt: request.prompt, image_urls: [...request.referenceUrls], num_images: 1, aspect_ratio: FRAME_ASPECT, resolution: "1K", output_format: "png" };
  }
  return { prompt: request.prompt, image_size: "portrait_16_9", num_inference_steps: 4, num_images: 1, output_format: "jpeg", enable_safety_checker: true };
}

const falOutput = z.object({ images: z.array(z.object({ url: z.url({ protocol: /^https$/ }) }).loose()).min(1) }).loose();

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** fal through its queue (subscribe), then the image downloaded from fal's https URL with a size cap. */
export function createFalRenderer(options: { credentials: string; client?: Pick<FalClient, "subscribe">; fetch?: typeof fetch; timeoutMs?: number }): FrameRenderer {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FRAME_RENDER_TIMEOUT_MS;
  return {
    async render(request, renderOptions = {}) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const abortSignal = renderOptions.abortSignal ? AbortSignal.any([timeout, renderOptions.abortSignal]) : timeout;
      let data: unknown;
      try {
        ({ data } = await client.subscribe(request.model.endpoint, { input: falInput(request), abortSignal }));
      } catch (error) {
        // fal's errors can echo the request; only the kind and status are kept. A refusal with an HTTP
        // status is not billed; a job cut off by the deadline, or a network error while polling, may
        // already be running on fal, so those are.
        const code = (error as { status?: unknown }).status;
        const status = typeof code === "number" ? ` (HTTP ${code})` : "";
        throw new FrameRenderError(`fal could not render the frame${status}: ${error instanceof Error ? error.name : "error"}.`, { billed: abortSignal.aborted || typeof code !== "number" });
      }
      // From here on fal has rendered (and billed) the frame.
      const parsed = falOutput.safeParse(data);
      if (!parsed.success) throw new FrameRenderError("fal answered without an image.", { billed: true });
      const url = parsed.data.images[0].url;
      if (!isFalMedia(url)) throw new FrameRenderError("fal answered with an image outside its own media hosts.", { billed: true });
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: abortSignal, redirect: "error" });
      } catch (error) {
        throw new FrameRenderError(`The rendered frame could not be downloaded: ${error instanceof Error ? error.name : "network error"}.`, { billed: true });
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!response.ok || !IMAGE_TYPES[contentType]) throw new FrameRenderError(`The rendered frame could not be downloaded (HTTP ${response.status}, ${contentType || "no type"}).`, { billed: true });
      if (Number(response.headers.get("content-length")) > FRAME_MAX_BYTES) throw new FrameRenderError("The rendered frame is too large.", { billed: true });
      const bytes = await readCapped(response, FRAME_MAX_BYTES);
      if (bytes.byteLength === 0) throw new FrameRenderError("The rendered frame is empty.", { billed: true });
      return { bytes, contentType };
    },
  };
}

/** The app's renderer: fal with the server-side FAL_KEY, or null when there is no key (frames then pause). */
export function frameRendererFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): FrameRenderer | null {
  const key = env.FAL_KEY?.trim();
  return key ? createFalRenderer({ credentials: key }) : null;
}

// --- Rendering a world's frames --------------------------------------------------------------------

export interface FramesEnv {
  store: Store;
  /** Null when no storage is configured: frames pause with NO_SERVICE_REASON. */
  storage: Storage | null;
  /** Null when no frame service is configured: frames pause with NO_SERVICE_REASON. */
  renderer: FrameRenderer | null;
  /** Claude for the critique: the runtime passes the run's memoized model. */
  model: LanguageModel;
  /** FRAMES_DAILY_CAP; defaults to the environment's. */
  framesCap?: number;
  now?: () => Date;
  abortSignal?: AbortSignal;
}

export interface FramesJob {
  runId: string;
  attempt: number;
  segmentId: string;
  world: World;
  /** Null (or absent) renders the world's own pack; a revision's id renders that revision's pack. */
  revisionId?: string | null;
  product: ProductSpec;
  /** Every real name the run knows, kept out of prompts and rewrites. Defaults to the world's own names. */
  names?: readonly string[];
}

export interface FramesOutcome {
  /** skipped: another job holds this world's lock, or its frames are already done. */
  status: "done" | "paused" | "failed" | "skipped";
  frames: WorldFrames | null;
  cost: CostDelta;
}

const cachedFrameSchema = z.strictObject({ url: z.url({ protocol: /^https$/ }), modelId: z.string().min(1) });

/** The pack and brief a job renders: the world's own, or one of its revisions'. */
export function framesSource(world: World, revisionId: string | null): { pack: ProductionPack; brief: BriefSlots } | null {
  const source = revisionId === null ? world : world.revisions.find((r) => r.id === revisionId);
  return source?.pack && source.brief ? { pack: source.pack, brief: source.brief } : null;
}

/** The world's own names, when the caller passes none: its sources and scored picks. */
function worldNames(world: World): string[] {
  const names = new Set<string>();
  for (const field of world.culture ?? []) for (const s of field.sources) if (s.kind === "entity") names.add(s.name);
  for (const pick of world.check?.picks ?? []) if (pick.kind === "entity") names.add(pick.name);
  return [...names].filter((name) => /\s/.test(name.trim()) || name !== name.toLowerCase());
}

/** Takes up to `want` frames from today's cap and gives back what does not fit. Returns how many it got. */
async function reserve(store: Store, day: string, want: number, cap: number): Promise<number> {
  if (want <= 0) return 0;
  const key = keys.daily("frames", day);
  const after = await store.incr(key, { by: want, ttlSeconds: TTL.daily });
  const granted = Math.max(0, Math.min(want, cap - (after - want)));
  if (granted < want) await store.incr(key, { by: granted - want });
  return granted;
}

async function giveBack(store: Store, day: string, count: number): Promise<void> {
  if (count > 0) await store.incr(keys.daily("frames", day), { by: -count });
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text);
const shots = (scenes: readonly number[]) => {
  const n = scenes.map((s) => String(s + 1));
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
};

/**
 * Renders one world's frames, critiques them and re-renders each kept rewrite once. Writes
 * world.frames events (rendering, then done, paused or failed) and trace steps under "frames" to the
 * attempt's list, adds the cost to the run's last cost, and refreshes the stored report.
 */
export async function renderWorldFrames(env: FramesEnv, job: FramesJob): Promise<FramesOutcome> {
  const revisionId = job.revisionId ?? null;
  const source = framesSource(job.world, revisionId);
  if (!source) throw new Error(`World ${job.segmentId} has no Production Pack${revisionId ? ` for revision ${revisionId}` : ""} to render.`);
  const { store } = env;
  const lock = keys.run.framesLock(job.runId, job.attempt, job.segmentId);
  const now = env.now ?? (() => new Date());
  if (!(await store.set(lock, { revisionId, at: now().toISOString() }, { ifAbsent: true, ttlSeconds: FRAMES_LOCK_SECONDS }))) {
    return { status: "skipped", frames: null, cost: emptyDelta() };
  }
  try {
    // Checked again inside the lock: a repeat request for frames already done renders nothing.
    const state = await runState(store, job.runId, job.attempt);
    const existing = state.worlds.find((w) => w.segmentId === job.segmentId)?.frames ?? null;
    if (existing && existing.revisionId === revisionId && existing.status === "done") return { status: "skipped", frames: existing, cost: emptyDelta() };
    return await render(env, job, source, revisionId, now);
  } finally {
    await store.del(lock);
  }
}

interface Rendered {
  plan: FramePrompt;
  frame: Frame;
  fresh: boolean;
}

async function render(env: FramesEnv, job: FramesJob, source: { pack: ProductionPack; brief: BriefSlots }, revisionId: string | null, now: () => Date): Promise<FramesOutcome> {
  const { store } = env;
  const day = dayOf(now().getTime());
  const cap = env.framesCap ?? dailyCaps().frames;
  const { pack, brief } = source;
  const label = job.world.label;
  const cost = emptyDelta();
  const step = (text: string, reason?: string): RunEventInput => ({
    type: "trace.step",
    step: { stage: "frames", kind: "decision", label: clip(text, 200), ...(reason ? { reason: clip(reason, 600) } : {}), segmentId: job.segmentId },
  });
  const framesEvent = (frames: WorldFrames): RunEventInput => ({ type: "world.frames", segmentId: job.segmentId, frames });
  const write = (inputs: RunEventInput[]) => appendRunEvents(store, job.runId, job.attempt, inputs, now);
  const finish = async (frames: WorldFrames, steps: RunEventInput[], status: FramesOutcome["status"]): Promise<FramesOutcome> => {
    await write([framesEvent(frames), ...steps]);
    // The run's duration is how long the run took; frames add their spend, not their time.
    await addRunCost(store, job.runId, job.attempt, cost, now);
    await refreshReport(store, job.runId);
    return { status, frames, cost };
  };
  const ended = (status: "paused" | "failed", reason: string, frames: Frame[] = []): WorldFrames => ({ revisionId, status, reason, frames, critiques: [] });

  if (!env.renderer || !env.storage) return finish(ended("paused", NO_SERVICE_REASON), [step("Storyboards are off", "No frame service or storage is configured, so the brief, kit and prompts show without frames.")], "paused");
  const { renderer, storage } = env;

  // The prompts, each checked by the same guardrails as every other prompt before it can render.
  const names = job.names ?? worldNames(job.world);
  const allowedNames = [...brief.allowedPlaces, ...(job.product.brandName ? [job.product.brandName] : [])];
  const guard = (text: string) => checkText(text, { names: [...names, ...FAMOUS_PLACES], allowedNames, exactCaseNames: true });
  const input = (sceneIndex: number) => ({ pack, brief, product: job.product, sceneIndex });
  const planned = frameScenes(pack.concept.scenes).map((scene) => buildFramePrompt(input(scene)));
  const blocked = planned.filter((plan) => guard(plan.prompt).length > 0);
  const plans = planned.filter((plan) => !blocked.includes(plan));
  const steps: RunEventInput[] = blocked.map((plan) => step(`Left out frame ${plan.scene + 1}`, `Its prompt breaks the guardrails: ${guard(plan.prompt)[0].message}`));
  if (plans.length === 0) return finish(ended("failed", BLOCKED_REASON), steps, "failed");

  await write([framesEvent({ revisionId, status: "rendering", reason: null, frames: [], critiques: [] })]);

  /** Renders (or reuses) one prompt. A fresh render must already be reserved against the cap. */
  const renderOne = async (plan: FramePrompt, attempt: 1 | 2): Promise<Rendered> => {
    const image = await renderer.render({ model: plan.model, prompt: plan.prompt, referenceUrls: plan.referenceUrls }, env.abortSignal ? { abortSignal: env.abortSignal } : {});
    // Past this point the frame was rendered: any failure (a storage or store write) is still billed.
    const extension = IMAGE_TYPES[image.contentType];
    if (!extension) throw new FrameRenderError(`The frame came back as ${image.contentType}.`, { billed: true });
    const stored = await storage.put(`frames/${plan.promptHash}.${extension}`, image.bytes, image.contentType, env.abortSignal ? { abortSignal: env.abortSignal } : {});
    await store.set(keys.frames.render(plan.promptHash), { url: stored.url, modelId: plan.model.endpoint }, { ttlSeconds: TTL.frameRender });
    return { plan, frame: { scene: plan.scene, url: stored.url, promptHash: plan.promptHash, modelId: plan.model.endpoint, attempt }, fresh: true };
  };
  const cachedOf = async (plan: FramePrompt, attempt: 1 | 2): Promise<Rendered | null> => {
    const hit = cachedFrameSchema.safeParse(await store.get(keys.frames.render(plan.promptHash)));
    return hit.success ? { plan, frame: { scene: plan.scene, url: hit.data.url, promptHash: plan.promptHash, modelId: hit.data.modelId, attempt }, fresh: false } : null;
  };

  /** Cached frames first, then fresh renders within the cap. `all` decides whether a cap shortfall renders none or as many as fit. */
  const pass = async (list: readonly FramePrompt[], attempt: 1 | 2, all: boolean) => {
    const cached = await Promise.all(list.map((plan) => cachedOf(plan, attempt)));
    const hits = cached.filter((c): c is Rendered => c !== null);
    const fresh = list.filter((_, i) => cached[i] === null);
    const granted = await reserve(store, day, fresh.length, cap);
    if (all && granted < fresh.length) {
      await giveBack(store, day, granted);
      return { hits, rendered: [] as Rendered[], failed: [] as { plan: FramePrompt; message: string; billed: boolean }[], capped: fresh, capSpent: true };
    }
    const settled = await Promise.allSettled(fresh.slice(0, granted).map((plan) => renderOne(plan, attempt)));
    const rendered = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    const failed = settled.flatMap((s, i) => (s.status === "rejected" ? [{ plan: fresh[i], message: s.reason instanceof Error ? s.reason.message : String(s.reason), billed: wasBilled(s.reason) }] : []));
    // Only a render the vendor refused gives its reservation back; a billed one stays counted.
    await giveBack(store, day, failed.filter((f) => !f.billed).length);
    for (const plan of [...rendered.map((r) => r.plan), ...failed.filter((f) => f.billed).map((f) => f.plan)]) {
      cost.frames++;
      cost.estimateUsd += plan.model.usdPerFrame;
    }
    return { hits, rendered, failed, capped: fresh.slice(granted), capSpent: granted < fresh.length };
  };

  try {
    const first = await pass(plans, 1, true);
    if (first.capSpent) {
      steps.push(step("Storyboards paused today", "The daily frame cap is spent; the brief, kit and prompts are ready without frames."));
      return finish(ended("paused", PAUSED_REASON, first.hits.map((h) => h.frame)), steps, "paused");
    }
    const firsts = [...first.hits, ...first.rendered].sort((a, b) => a.plan.scene - b.plan.scene);
    steps.unshift(
      step(
        `Rendered ${firsts.length} storyboard ${firsts.length === 1 ? "frame" : "frames"} for ${label}`,
        `${first.rendered.length} new, ${first.hits.length} from the frame cache (cached frames are free). ${firsts[0]?.plan.model.displayName ?? FRAME_MODELS.text.displayName}${firsts[0]?.plan.referenceUrls.length ? ", with the product's own photo as the reference" : ", from the text description"}.`,
      ),
    );
    for (const f of first.failed) steps.push(step(`Frame ${f.plan.scene + 1} did not render`, f.message));
    if (firsts.length === 0) return finish(ended("failed", clip(`The frame service failed: ${first.failed[0]?.message ?? "no frame came back"}`, 200)), steps, "failed");

    // The critique: Claude reviews every frame, and each kept rewrite re-renders once.
    const counted = countingModel(env.model, cost.claude);
    let review: CritiqueResult;
    try {
      review = await critiqueFrames(
        counted.model,
        {
          frames: firsts.map((r) => ({ scene: r.plan.scene, url: r.frame.url, body: r.plan.body })),
          concept: pack.concept,
          brief,
          product: job.product,
          checklist: frameChecklist(pack, job.product),
          names,
        },
        env.abortSignal ? { abortSignal: env.abortSignal } : {},
      );
    } catch (error) {
      if (env.abortSignal?.aborted) throw error;
      review = { critiques: [], refused: [], failure: error instanceof Error ? error.name : "the review failed" };
    }
    if (review.failure) steps.push(step("Skipped the frame review", `${review.failure}; the frames stand as rendered.`));
    for (const refused of review.refused) steps.push(step(`Kept frame ${refused.scene + 1}'s prompt`, `The rewrite was refused: ${refused.reason}.`));

    const rewrites = review.critiques.filter((c) => c.rewrite !== null);
    const replans = rewrites.flatMap((c) => {
      const plan = buildFramePrompt(input(c.scene), c.rewrite as string);
      // The closing rules are code's, but the whole prompt is checked again.
      const issues = guard(plan.prompt);
      if (issues.length === 0) return [plan];
      steps.push(step(`Kept frame ${c.scene + 1}'s prompt`, `The rewritten prompt was refused: ${issues[0].message}`));
      return [];
    });
    const second = await pass(replans, 2, false);
    const reRendered = new Map([...second.hits, ...second.rendered].map((r) => [r.plan.scene, r]));
    for (const f of second.failed) steps.push(step(`Frame ${f.plan.scene + 1} did not re-render`, `${f.message} The first frame stands.`));
    for (const plan of second.capped) steps.push(step(`Kept frame ${plan.scene + 1} as it was`, "The daily frame cap is spent, so its rewrite did not re-render."));

    // A rewrite that never re-rendered is not shown as one.
    const critiques = review.critiques.map((c) => (c.rewrite !== null && !reRendered.has(c.scene) ? { ...c, rewrite: null } : c));
    const byScene = new Map(firsts.map((r) => [r.plan.scene, r]));
    for (const c of critiques.filter((x) => x.issues.length > 0)) {
      const before = byScene.get(c.scene);
      const after = reRendered.get(c.scene);
      const action = pack.concept.scenes[c.scene]?.action ?? before?.plan.body ?? "";
      steps.push(step(`Frame ${c.scene + 1}: ${c.issues.join(", ")}`, after ? `Before: ${action} After: ${c.rewrite}` : "No rewrite: the frame stands as rendered."));
    }
    const passing = critiques.filter((c) => c.issues.length === 0).map((c) => c.scene);
    if (passing.length) steps.push(step(`Frame${passing.length === 1 ? "" : "s"} ${shots(passing)} ${passing.length === 1 ? "passes" : "pass"} the checklist`));

    const frames = [...firsts.map((r) => r.frame), ...[...reRendered.values()].map((r) => r.frame)].sort((a, b) => a.scene - b.scene || a.attempt - b.attempt);
    return finish({ revisionId, status: "done", reason: null, frames, critiques }, steps, "done");
  } catch (error) {
    // The job's deadline (the route's time limit) ends it as a failure the viewer can see.
    const message = env.abortSignal?.aborted ? "The storyboards ran out of time." : error instanceof Error ? error.message : String(error);
    return finish(ended("failed", clip(`Storyboards failed: ${message}`, 200)), [...steps, step("Storyboards failed", message)], "failed");
  }
}

// --- POST /api/frames/<id> ---------------------------------------------------------------------------

/** Frame jobs one visitor may start in an hour, across runs (each one still spends the daily cap). */
export const FRAMES_PER_VISITOR_HOUR = 20;

export interface FramesRouteDeps {
  live: boolean;
  /** The process's store (lib/store/index.ts getStore); it throws where no shared store is configured. */
  store: () => Store;
  headers: Headers;
  /** True when a frame service and storage are set up; without them nothing is scheduled. */
  configured: boolean;
  framesCap?: number;
  perVisitorHour?: number;
  now?: () => number;
  /** Runs the job after the response (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
  /** The job itself, with the route's storage, renderer and model. */
  job: (job: FramesJob) => Promise<FramesOutcome>;
}

const answer = (status: number, body: FramesResponse): RouteAnswer<FramesResponse> => ({ status, body: framesResponseSchema.parse(body) });

/**
 * Starts a world's storyboard frames for a finished live run: the run must exist and have ended, the
 * world must have a pack (its latest revision's when it has one), and frames already done or rendering
 * for that pack are not started again (a "rendering" whose job died, its lock gone, is started again).
 * Nothing is scheduled without a frame service, for prompts the guardrails refused, or past the
 * visitor's hourly limit. The work runs after the response. While a run is still going, the runtime
 * renders each world's frames itself as its pack lands.
 */
export async function requestFrames(deps: FramesRouteDeps, id: string, body: unknown): Promise<RouteAnswer<FramesResponse>> {
  if (!deps.live) return apiError("off", "Live runs are off, so storyboards do not render. The examples show their frames.");
  const runId = liveRunIdSchema.safeParse(id);
  if (!runId.success) return apiError("invalid", "That is not a live run id.");
  const parsed = framesRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid", "Send the world's segmentId.");
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return apiError("failed", "No shared store is configured on this server.", 503);
  }
  const meta = await getRunMeta(store, runId.data);
  if (!meta) return apiError("not_found", "No live run with that id (runs are kept for 7 days).");
  // Finished runs only: their cost record exists, so a job's spend always lands on it.
  if (meta.status !== "done" && meta.status !== "failed") return apiError("busy", "Storyboards render on their own while the run is going.");
  const state = await runState(store, runId.data, meta.attempt);
  const world = state.worlds.find((w) => w.segmentId === parsed.data.segmentId);
  if (!world || !state.inputs) return apiError("not_found", "This run has no world with that id.");
  // The pack on show: the latest revision's, else the world's own.
  const revision = [...world.revisions].reverse().find((r) => r.pack !== null) ?? null;
  const revisionId = revision?.id ?? null;
  if (!framesSource(world, revisionId)) return apiError("invalid", "This world has no Production Pack yet.", 409);
  const current = world.frames?.revisionId === revisionId ? world.frames : null;
  if (current?.status === "done") return answer(200, { status: "done", message: null });
  if (!deps.configured) return answer(200, { status: "paused", message: NO_SERVICE_REASON });
  // A job holds the lock while it renders; a "rendering" with no lock is a job that died.
  if (current?.status === "rendering" && (await store.get(keys.run.framesLock(runId.data, meta.attempt, world.segmentId))) !== null) return answer(200, { status: "rendering", message: null });
  if (current?.status === "failed" && current.reason === BLOCKED_REASON) return apiError("invalid", "This world's frame prompts break the guardrails, so its storyboards cannot render.", 409);
  // Paused for the cap and the cap still spent: nothing new to try today (cached frames stay free for a new pack).
  const used = (await store.get<number>(keys.daily("frames"))) ?? 0;
  if (current?.status === "paused" && used >= (deps.framesCap ?? dailyCaps().frames)) return answer(200, { status: "paused", message: PAUSED_REASON });

  const visitor = await visitorId(store, deps.headers);
  const hour = new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 13);
  const count = await store.incr(keys.rate("frames", visitor, hour), { ttlSeconds: 60 * 60 + 60 });
  if (count > (deps.perVisitorHour ?? FRAMES_PER_VISITOR_HOUR)) return apiError("rate_limited", "That is a lot of storyboards in an hour. Try again later.");

  const job: FramesJob = { runId: runId.data, attempt: meta.attempt, segmentId: world.segmentId, world, revisionId, product: state.inputs.product, names: reportNames({ ...state, inputs: state.inputs }) };
  deps.schedule(() => deps.job(job));
  return answer(202, { status: "rendering", message: null });
}
