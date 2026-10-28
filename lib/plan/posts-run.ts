// The marketing step of a live plan, as its own invocation (POST /api/plan/<id>/marketing): it freezes
// the poster art prompt (poster.updated, queued), writes the posts (posts.ready) and paints the
// background art (poster.updated, ready, skipped or failed), with trace steps under "marketing" and
// the spend added to the run's cost. The checks answer at once; the work runs after the response.
// Examples ship with their poster and posts recorded, so nothing runs for them.
//
// And GET /api/plan/<id>/marketing/poster.png: the composited poster for a live run or an example,
// always an image. The art is used only when it rendered and lives on Stoop's own storage (or the
// site's own origin, for approved example art); anything else gets the plain background.
import type { LanguageModel } from "ai";
import { z } from "zod";
import { apiError, type RouteAnswer } from "../route-answer";
import { PRICES } from "../runtime/cost";
import { POSTER_MODEL } from "../prompts/models.config";
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import { visitorId, type CookieVisitorId } from "../store/visitor";
import type { StoryboardVisitor } from "../media/storyboards";
import type { PlanEventInput } from "./events";
import { posterKeys, queuedPoster, renderPosterArt, type PosterArtEnv } from "./poster-art";
import { posterImage, type PosterArt, type PosterSize } from "./poster-image";
import { posterText } from "./poster-text";
import { generatePosts } from "./posts";
import { exampleSlugOf, reportOf, type MarketingReport, type PlanSource } from "./posts-store";
import type { Cost } from "../report/stages";
import { shareLinks } from "./share";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/posts-run runs on the server only.");
}

/** Marketing requests one visitor may make in an hour, across plans. */
export const MARKETING_PER_VISITOR_HOUR = 10;
/** The lock outlives the route's time limit, so a crashed job frees its plan within minutes. */
export const MARKETING_LOCK_SECONDS = 10 * 60;

const RUN_ID = /^[A-Za-z0-9_-]{6,64}$/;

export const marketingResponseSchema = z.strictObject({
  status: z.enum(["working", "done"]),
  message: z.string().nullable(),
});
export type MarketingResponse = z.infer<typeof marketingResponseSchema>;

const answer = (status: number, body: MarketingResponse): RouteAnswer<MarketingResponse> => ({ status, body: marketingResponseSchema.parse(body) });

// --- The job ---------------------------------------------------------------------------------------

export interface MarketingEnv {
  store: Store;
  source: PlanSource;
  /** Claude for the posts; null writes the deterministic template. */
  model: LanguageModel | null;
  art: Omit<PosterArtEnv, "store" | "now" | "abortSignal">;
  /** The site's origin, for the share links. */
  origin: string;
  now?: () => Date;
  abortSignal?: AbortSignal;
}

const step = (label: string, reason?: string): PlanEventInput => ({ type: "trace.step", step: { stage: "marketing", kind: "decision", label, ...(reason ? { reason: reason.slice(0, 600) } : {}) } });

function addCost(cost: Cost, claude: { calls: number; inputTokens: number; outputTokens: number }, billedArt: boolean): Cost {
  return {
    ...cost,
    claude: { ...cost.claude, calls: cost.claude.calls + claude.calls, inputTokens: cost.claude.inputTokens + claude.inputTokens, outputTokens: cost.claude.outputTokens + claude.outputTokens },
    frames: cost.frames + (billedArt ? 1 : 0),
    estimateUsd: Math.round((cost.estimateUsd + (claude.inputTokens * PRICES.input + claude.outputTokens * PRICES.output) / 1_000_000 + (billedArt ? POSTER_MODEL.usdPerImage : 0)) * 10_000) / 10_000,
  };
}

/** Writes one live plan's poster and posts. Returns false when another job holds the plan. */
export async function runMarketing(env: MarketingEnv, runId: string, visitor: StoryboardVisitor | null): Promise<boolean> {
  const now = env.now ?? (() => new Date());
  const started = now().getTime();
  if (!(await env.store.set(posterKeys.lock(runId), { at: now().toISOString() }, { ifAbsent: true, ttlSeconds: MARKETING_LOCK_SECONDS }))) return false;
  try {
    const state = await env.source.state(runId);
    const report = state ? reportOf(state) : null;
    if (!report?.plan) return true;
    const queued = queuedPoster(report);
    await env.source.append(runId, [
      { type: "stage.started", stage: "marketing" },
      { type: "poster.updated", poster: queued },
      step("Froze the poster art prompt", "Background art only: no text, no logos, no people, no names. Every word on the poster is set by code from the plan and the manager's offers."),
    ]);
    const [written, art] = await Promise.all([
      generatePosts(env.model, report, env.abortSignal ? { abortSignal: env.abortSignal } : {}),
      renderPosterArt({ ...env.art, store: env.store, now, ...(env.abortSignal ? { abortSignal: env.abortSignal } : {}) }, report, visitor),
    ]);
    const posts = { ...written.posts, share: shareLinks(env.origin, runId, written.posts) };
    const events: PlanEventInput[] = [
      { type: "posts.ready", posts },
      written.source === "claude"
        ? step("Wrote the Facebook, Instagram and WhatsApp drafts", "Names come only from this plan's Qloo results; offers, date and address are the manager's words, verbatim. Nothing posts until the manager taps Share.")
        : step("Used the plain post template", written.refusedFor.length ? `The drafts did not pass the checks: ${written.refusedFor[0]}` : "No writer was available, so the posts use the plan's own title and hook."),
      { type: "poster.updated", poster: art.poster },
      art.poster.status === "ready"
        ? step("Painted the poster background", `${POSTER_MODEL.displayName}, from the city's music styles turned into color and texture.${art.billed ? "" : " From the art cache, at no cost."}`)
        : step("The poster uses the plain background", art.poster.reason),
    ];
    if (report.cost && (written.usage.calls > 0 || art.billed)) events.push({ type: "run.cost", cost: addCost(report.cost, written.usage, art.billed) });
    events.push({ type: "stage.done", stage: "marketing", stats: { durationMs: now().getTime() - started, liveCalls: 0, cachedCalls: 0 } });
    await env.source.append(runId, events);
    return true;
  } finally {
    await env.store.del(posterKeys.lock(runId));
  }
}

// --- POST /api/plan/<id>/marketing -------------------------------------------------------------------

export interface MarketingRouteDeps {
  live: boolean;
  store: () => Store;
  source: (store: Store) => PlanSource;
  headers: Headers;
  cookieVisitor?: CookieVisitorId | null;
  perVisitorHour?: number;
  now?: () => number;
  schedule: (task: () => Promise<unknown>) => void;
  job: (store: Store, source: PlanSource, runId: string, visitor: StoryboardVisitor) => Promise<unknown>;
}

const FINAL = new Set(["ready", "skipped", "failed"]);

export async function requestMarketing(deps: MarketingRouteDeps, id: string): Promise<RouteAnswer<MarketingResponse>> {
  if (exampleSlugOf(id)) return answer(200, { status: "done", message: "Examples ship with their poster and posts." });
  if (!deps.live) return apiError("off", "Live runs are off, so posters and posts are not written. The examples show theirs.");
  if (!RUN_ID.test(id)) return apiError("invalid", "That is not a plan id.");
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return apiError("failed", "No shared store is configured on this server.", 503);
  }
  const source = deps.source(store);
  const state = await source.state(id);
  const report = state ? reportOf(state) : null;
  if (!state || !report) return apiError("not_found", "No plan with that id (plans are kept for 7 days).");
  if (!report.plan || state.status === "running" || state.status === "idle") return apiError("busy", "The plan is still being written. The poster and posts follow it.");
  if (state.status === "failed") return apiError("invalid", "This plan did not finish, so it has no poster or posts.", 409);
  if (report.posts && FINAL.has(report.poster.status)) return answer(200, { status: "done", message: null });
  if (await store.get(posterKeys.lock(id))) return answer(202, { status: "working", message: null });
  const ip = await visitorId(store, deps.headers);
  const hour = new Date(deps.now?.() ?? Date.now()).toISOString().slice(0, 13);
  const count = await store.incr(keys.rate("marketing", ip, hour), { ttlSeconds: 60 * 60 + 60 });
  if (count > (deps.perVisitorHour ?? MARKETING_PER_VISITOR_HOUR)) return apiError("rate_limited", "That is a lot of posters in an hour. Try again later.");
  const visitor: StoryboardVisitor = { id: ip, cookie: deps.cookieVisitor ?? null };
  deps.schedule(() => deps.job(store, source, id, visitor));
  return answer(202, { status: "working", message: null });
}

// --- GET /api/plan/<id>/marketing/poster.png ---------------------------------------------------------

export const ART_FETCH_TIMEOUT_MS = 8_000;
export const ART_MAX_BYTES = 12 * 1024 * 1024;
const ART_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Where poster art may be read from: Stoop's public Blob store, its R2 public URL, or the site's own
 * origin (approved example art under /demo). Anything else is never fetched.
 */
export function trustedArtUrl(url: string, origins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  if (/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(parsed.hostname)) return true;
  return origins.some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

export interface PosterRouteDeps {
  live: boolean;
  store: () => Store;
  source: (store: Store | null) => PlanSource;
  /** Origins art may come from besides the Blob store (R2_PUBLIC_URL, the site's own). */
  artOrigins: readonly string[];
  fetch?: typeof fetch;
}

async function fetchArt(url: string, fetchImpl: typeof fetch): Promise<PosterArt | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(ART_FETCH_TIMEOUT_MS), redirect: "error" });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!response.ok || !ART_TYPES.has(type)) return null;
    if (Number(response.headers.get("content-length")) > ART_MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > ART_MAX_BYTES) return null;
    return { dataUri: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` };
  } catch {
    return null;
  }
}

async function findReport(deps: PosterRouteDeps, id: string): Promise<MarketingReport | null> {
  const slug = exampleSlugOf(id);
  if (slug) return deps.source(null).example(slug);
  if (!deps.live || !RUN_ID.test(id)) return null;
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return null;
  }
  const state = await deps.source(store).state(id);
  return state ? reportOf(state) : null;
}

/** The composited poster PNG, or a 404 for an unknown plan. Never an error image. */
export async function posterResponse(deps: PosterRouteDeps, id: string, size: PosterSize): Promise<Response> {
  const report = await findReport(deps, id);
  if (!report) return Response.json({ error: { code: "not_found", message: "No plan with that id." } }, { status: 404, headers: { "cache-control": "no-store" } });
  const { poster } = report;
  const art = poster.status === "ready" && poster.url && trustedArtUrl(poster.url, deps.artOrigins) ? await fetchArt(poster.url, deps.fetch ?? globalThis.fetch) : null;
  const example = report.meta.kind === "example";
  const settled = example || FINAL.has(poster.status);
  // A poster whose art could not be read this time is never cached, so the next request tries again.
  const cache = !settled || (poster.status === "ready" && !art) ? "no-store" : example ? "public, max-age=3600, s-maxage=86400" : "public, max-age=300, s-maxage=3600";
  return posterImage(posterText(report), art, size, { "cache-control": cache });
}
