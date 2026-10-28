// The poster's background art on fal (POSTER_MODEL), the one image a plan renders. The prompt is frozen
// with its promptHash before anything renders (lib/plan/poster-prompt.ts). Spend is guarded the way
// storyboard frames are (lib/media/frames.ts):
//   a render cache by prompt hash (posterKeys.render), so the same prompt never renders twice
//   the global FRAMES_DAILY_CAP: a poster takes one frame from the day, given back when fal refused it
//   the visitor's storyboard jobs for the day (lib/media/storyboards.ts): a poster counts as one job
// Bytes go to storage through lib/storage.ts. Whatever happens, the answer is a poster state the page
// can show: art that is off, capped, refused or failed leaves the plain background, with a reason.
import { createFalClient, type FalClient } from "@fal-ai/client";
import { z } from "zod";
import { dailyCaps } from "../config";
import { FrameRenderError, isFalMedia, wasBilled, type RenderedImage } from "../media/frames";
import { reserveStoryboard, type StoryboardLimits, type StoryboardVisitor } from "../media/storyboards";
import { POSTER_MODEL } from "../prompts/models.config";
import { giveBack, reserveUpTo } from "../rate-limit";
import type { Storage } from "../storage";
import { dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { buildPosterPrompt, checkPosterPrompt } from "./poster-prompt";
import { posterAlt, posterText } from "./poster-text";
import type { PlanReport, Poster } from "./schema";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/poster-art runs on the server only.");
}

export const POSTER_RENDER_TIMEOUT_MS = 90_000;
export const POSTER_MAX_BYTES = 15 * 1024 * 1024;

/** Why the poster shows the plain background, in the words the page shows. */
export const POSTER_REASONS = {
  off: "Live art is off, so the poster uses the plain background.",
  noService: "Poster art is not set up on this server, so the poster uses the plain background.",
  paused: "Poster art is paused for today, so the poster uses the plain background.",
  blocked: "The art prompt did not pass the guardrails, so the poster uses the plain background.",
  failed: "The art did not render, so the poster uses the plain background.",
  pending: "The background art is waiting for review, so the poster uses the plain background.",
} as const;

export const posterKeys = {
  /** A rendered background by its prompt hash: { url, modelId }. */
  render: (promptHash: string) => `poster:render:${promptHash}`,
  /** Held while one run's marketing job runs, so two clicks never generate twice. */
  lock: (runId: string) => `plan:${runId}:marketing:lock`,
} as const;

export interface PosterRenderer {
  render(request: { endpoint: string; input: Record<string, unknown> }, options?: { abortSignal?: AbortSignal }): Promise<RenderedImage>;
}

const falOutput = z.object({ images: z.array(z.object({ url: z.url({ protocol: /^https$/ }) }).loose()).min(1) }).loose();
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

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
      throw new FrameRenderError("The rendered art is too large.", { billed: true });
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

/** fal through its queue (subscribe), then the image fetched from fal's own https media host with a size cap. */
export function createPosterRenderer(options: { credentials: string; client?: Pick<FalClient, "subscribe">; fetch?: typeof fetch; timeoutMs?: number }): PosterRenderer {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async render(request, renderOptions = {}) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? POSTER_RENDER_TIMEOUT_MS);
      const abortSignal = renderOptions.abortSignal ? AbortSignal.any([timeout, renderOptions.abortSignal]) : timeout;
      let data: unknown;
      try {
        ({ data } = await client.subscribe(request.endpoint, { input: request.input, abortSignal }));
      } catch (error) {
        // fal's errors can echo the request: only the kind and status are kept.
        const code = (error as { status?: unknown }).status;
        throw new FrameRenderError(`fal could not render the art${typeof code === "number" ? ` (HTTP ${code})` : ""}.`, { billed: abortSignal.aborted || typeof code !== "number" });
      }
      const parsed = falOutput.safeParse(data);
      if (!parsed.success) throw new FrameRenderError("fal answered without an image.", { billed: true });
      const url = parsed.data.images[0]!.url;
      if (!isFalMedia(url)) throw new FrameRenderError("fal answered with an image outside its own media hosts.", { billed: true });
      let response: Response;
      try {
        response = await fetchImpl(url, { signal: abortSignal, redirect: "error" });
      } catch {
        throw new FrameRenderError("The rendered art could not be downloaded.", { billed: true });
      }
      const contentType = response.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase() ?? "";
      if (!response.ok || !IMAGE_TYPES[contentType]) throw new FrameRenderError(`The rendered art could not be downloaded (HTTP ${response.status}).`, { billed: true });
      const bytes = await readCapped(response, POSTER_MAX_BYTES);
      if (bytes.byteLength === 0) throw new FrameRenderError("The rendered art is empty.", { billed: true });
      return { bytes, contentType };
    },
  };
}

/** The app's renderer: fal with the server-side FAL_KEY, or null without one (the poster keeps the plain background). */
export function posterRendererFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): PosterRenderer | null {
  const key = env.FAL_KEY?.trim();
  return key ? createPosterRenderer({ credentials: key }) : null;
}

/** The poster before its art renders: prompt frozen, status queued. */
export function queuedPoster(report: Pick<PlanReport, "plan" | "local" | "inputs" | "meta">): Poster {
  const { prompt, promptHash } = buildPosterPrompt(report);
  return { status: "queued", prompt, promptHash, alt: posterAlt(posterText(report)) };
}

export interface PosterArtEnv {
  store: Store;
  /** Null when no storage is configured: the poster keeps the plain background. */
  storage: Storage | null;
  /** Null when there is no fal key: the poster keeps the plain background. */
  renderer: PosterRenderer | null;
  /** FRAMES_DAILY_CAP; defaults to the environment's. */
  framesCap?: number;
  storyboardLimits?: StoryboardLimits;
  now?: () => Date;
  abortSignal?: AbortSignal;
}

export interface PosterArtOutcome {
  poster: Poster;
  /** True when fal rendered (or may bill) a fresh image: the cost to add to the run. */
  billed: boolean;
}

const cachedSchema = z.strictObject({ url: z.url({ protocol: /^https$/ }), modelId: z.string().min(1) });

/**
 * Renders a plan's poster art once: the cache first, then a fresh render within the visitor's day and
 * the global frame cap. Never throws for a render problem: the poster comes back skipped or failed,
 * with a reason, and the text layer still renders on the plain background.
 */
export async function renderPosterArt(env: PosterArtEnv, report: Pick<PlanReport, "plan" | "local" | "inputs" | "meta">, visitor: StoryboardVisitor | null): Promise<PosterArtOutcome> {
  const { store } = env;
  const now = env.now ?? (() => new Date());
  const built = buildPosterPrompt(report);
  const base = { prompt: built.prompt, promptHash: built.promptHash, alt: posterAlt(posterText(report)) };
  const ended = (status: "skipped" | "failed", reason: string, billed = false): PosterArtOutcome => ({ poster: { ...base, status, reason }, billed });

  if (checkPosterPrompt(built.prompt, report).length > 0) return ended("skipped", POSTER_REASONS.blocked);
  const hit = cachedSchema.safeParse(await store.get(posterKeys.render(built.promptHash)));
  // A ready poster carries no url: the art stays in the cache by its prompt hash, and every page shows
  // the composited poster from the route, so the bare background is never mistaken for the poster.
  if (hit.success) return { poster: { ...base, status: "ready" }, billed: false };
  if (!env.renderer || !env.storage) return ended("skipped", POSTER_REASONS.noService);

  const at = now().getTime();
  const day = dayOf(at);
  const seat = visitor ? await reserveStoryboard(store, visitor, at, env.storyboardLimits) : null;
  if (visitor && !seat) return ended("skipped", POSTER_REASONS.paused);
  let granted: number;
  try {
    granted = await reserveUpTo(store, keys.daily("frames", day), 1, env.framesCap ?? dailyCaps().frames, TTL.daily);
  } catch (error) {
    await seat?.release().catch(() => undefined);
    throw error;
  }
  if (granted < 1) {
    await seat?.release();
    return ended("skipped", POSTER_REASONS.paused);
  }
  try {
    const image = await env.renderer.render({ endpoint: POSTER_MODEL.endpoint, input: built.input }, env.abortSignal ? { abortSignal: env.abortSignal } : {});
    const extension = IMAGE_TYPES[image.contentType];
    if (!extension) throw new FrameRenderError(`The art came back as ${image.contentType}.`, { billed: true });
    const stored = await env.storage.put(`posters/${built.promptHash}.${extension}`, image.bytes, image.contentType, env.abortSignal ? { abortSignal: env.abortSignal } : {});
    await store.set(posterKeys.render(built.promptHash), { url: stored.url, modelId: POSTER_MODEL.endpoint }, { ttlSeconds: TTL.frameRender });
    return { poster: { ...base, status: "ready" }, billed: true };
  } catch (error) {
    const billed = wasBilled(error);
    // Only a render fal refused gives its places back; a billed one stays counted.
    if (!billed) {
      await giveBack(store, keys.daily("frames", day), 1, TTL.daily);
      await seat?.release();
    }
    return ended("failed", POSTER_REASONS.failed, billed);
  }
}
