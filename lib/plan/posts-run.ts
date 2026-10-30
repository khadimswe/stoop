// The marketing step of a live plan, as its own invocation (POST /api/plan/<id>/marketing): it freezes
// the poster art prompt (poster.updated, queued), writes the posts (posts.ready) and paints the
// background art (poster.updated, ready, skipped or failed), with trace steps under "marketing" and
// the spend added to the run's cost. The checks answer at once; the work runs after the response.
// Examples ship with their poster and posts recorded, so nothing runs for them.
//
// When the plan carries an A/B test whose variant B runs another of its concepts, the job also writes
// variant B's posts and poster, so a store can test two online pushes and not only two events. The
// contract has one poster and one posts slot (variant A, the kept concept), so variant B is kept under
// its own key (variantKey) and read through GET /api/plan/<id>/marketing until the contract has a slot.
//
// And GET /api/plan/<id>/marketing/poster.png (?variant=b for B): the composited poster for a live run
// or an example, always an image. The art is used only when it rendered and lives on Stoop's own
// storage (or the site's own origin, for approved example art); anything else gets the plain background.
import type { LanguageModel } from "ai";
import { z } from "zod";
import { apiError, type RouteAnswer } from "../route-answer";
import { PRICES } from "../runtime/cost";
import { POSTER_MODEL } from "../prompts/models.config";
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { visitorId, type CookieVisitorId, type TokenVisitorId, type VisitorId } from "../store/visitor";
import type { StoryboardVisitor } from "../media/storyboards";
import type { PlanEventInput } from "./events";
import { POSTER_REASONS, posterKeys, queuedPoster, renderPosterArt, type PosterArtEnv } from "./poster-art";
import { posterImage, type PosterArt, type PosterSize } from "./poster-image";
import { MAX_POSTER_VERSIONS } from "./poster-prompt";
import { posterText, variantBConcept, withFrontConcept } from "./poster-text";
import { generatePosts, type PostsResult } from "./posts";
import { isExampleId, isLivePlanId, reportOf, type MarketingReport, type PlanSource } from "./posts-store";
import { planExampleSlug } from "./example-list";
import { loadApprovedArt, readApproval, type PosterApproval } from "./poster-approval";
import { sniffImage } from "./poster-sniff";
import type { Cost } from "../report/stages";
import { posterSchema, postsSchema, type Poster, type Posts } from "./schema";
import { shareLinks } from "./share";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/posts-run runs on the server only.");
}

/** Marketing requests one visitor may make in an hour, across plans. */
export const MARKETING_PER_VISITOR_HOUR = 10;
/** The lock outlives the route's time limit, so a crashed job frees its plan within minutes. */
export const MARKETING_LOCK_SECONDS = 10 * 60;

export const marketingResponseSchema = z.strictObject({
  status: z.enum(["working", "done"]),
  message: z.string().nullable(),
});
export type MarketingResponse = z.infer<typeof marketingResponseSchema>;

const answer = (status: number, body: MarketingResponse): RouteAnswer<MarketingResponse> => ({ status, body: marketingResponseSchema.parse(body) });

/** Variant B's poster and posts for one plan, kept until the contract has a slot for them. */
export const variantKey = (planId: string) => `plan:${planId}:marketing:b`;

export const variantMarketingSchema = z.strictObject({ conceptId: z.string().min(1), poster: posterSchema, posts: postsSchema.nullable() });
export type VariantMarketing = z.infer<typeof variantMarketingSchema>;

/** GET /api/plan/<id>/marketing: both variants' posters and posts (B only when the plan tests a second concept). */
export const marketingStateSchema = z.strictObject({
  a: z.strictObject({ conceptId: z.string().nullable(), poster: posterSchema, posts: postsSchema.nullable() }),
  b: variantMarketingSchema.nullable(),
});
export type MarketingState = z.infer<typeof marketingStateSchema>;

export async function readVariant(store: Store | null, planId: string): Promise<VariantMarketing | null> {
  if (!store) return null;
  try {
    const parsed = variantMarketingSchema.safeParse(await store.get(variantKey(planId)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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

function addCost(cost: Cost, claude: { calls: number; inputTokens: number; outputTokens: number }, billedArt: number): Cost {
  return {
    ...cost,
    claude: { ...cost.claude, calls: cost.claude.calls + claude.calls, inputTokens: cost.claude.inputTokens + claude.inputTokens, outputTokens: cost.claude.outputTokens + claude.outputTokens },
    frames: cost.frames + billedArt,
    estimateUsd: Math.round((cost.estimateUsd + (claude.inputTokens * PRICES.input + claude.outputTokens * PRICES.output) / 1_000_000 + billedArt * POSTER_MODEL.usdPerImage) * 10_000) / 10_000,
  };
}

/** Writes one live plan's poster and posts. Returns false when another job holds the plan. */
export async function runMarketing(env: MarketingEnv, runId: string, visitor: StoryboardVisitor | null): Promise<boolean> {
  const now = env.now ?? (() => new Date());
  const started = now().getTime();
  // The lock holds this job's own token, so a job that outlived its lock never frees another's.
  const token = crypto.randomUUID();
  if (!(await env.store.set(posterKeys.lock(runId), token, { ifAbsent: true, ttlSeconds: MARKETING_LOCK_SECONDS }))) return false;
  try {
    const state = await env.source.state(runId);
    const report = state ? reportOf(state) : null;
    if (!report?.plan) return true;
    // Checked again inside the lock: a job that just finished leaves nothing to do.
    if (report.posts && FINAL.has(report.poster.status)) return true;
    const queued = queuedPoster(report);
    await env.source.append(runId, [
      { type: "stage.started", stage: "marketing" },
      { type: "poster.updated", poster: queued },
      step("Froze the poster art prompt", "Background art only: no text, no logos, no people, no names. Every word on the poster is set by code from the plan and the manager's offers."),
    ]);
    const signal = env.abortSignal ? { abortSignal: env.abortSignal } : {};
    const artEnv = { ...env.art, store: env.store, now, ...signal };
    // Variant B, when the plan tests a second concept: the same writers, with that concept in front.
    const bId = variantBConcept(report);
    const bReport = bId ? withFrontConcept(report, bId) : null;
    // Neither writer may leave the plan half done: an error (the model's key, a store write, the
    // deadline) still ends in the plain template and the plain background, with the reason in the trace.
    const writePosts = (r: MarketingReport) => generatePosts(env.model, r, signal).catch(() => generatePosts(null, r));
    const paint = (r: MarketingReport) =>
      renderPosterArt(artEnv, r, visitor).catch(() => ({ poster: { ...queuedPoster(r), status: "failed" as const, reason: POSTER_REASONS.failed }, billed: false }));
    // B paints after A, so a B prompt that comes out the same as A's is a cache hit, never a second render.
    const artA = paint(report);
    const [written, art, bWritten, bArt] = await Promise.all([
      writePosts(report),
      artA,
      bReport ? writePosts(bReport) : Promise.resolve(null),
      bReport ? artA.then(() => paint(bReport)) : Promise.resolve(null),
    ]);
    const posts = { ...written.posts, share: shareLinks(env.origin, runId, written.posts) };
    const events: PlanEventInput[] = [
      { type: "posts.ready", posts },
      written.source === "claude"
        ? step("Wrote the Facebook, Instagram and WhatsApp drafts", "Names come only from this plan's Qloo results; offers, date and address are the manager's words, verbatim. Nothing posts until the manager approves it.")
        : step("Used the plain post template", written.refusedFor.length ? `The drafts did not pass the checks: ${written.refusedFor[0]}` : "No writer was available, so the posts use the plan's own title and hook."),
      { type: "poster.updated", poster: art.poster },
      art.poster.status === "ready"
        ? step("Painted the poster background", `${POSTER_MODEL.displayName}, from the city's music styles turned into color and texture.${art.billed ? "" : " From the art cache, at no cost."}`)
        : step("The poster uses the plain background", art.poster.reason),
    ];
    let usage: PostsResult["usage"] = written.usage;
    let billed = art.billed ? 1 : 0;
    if (bId && bWritten && bArt) {
      const bPosts: Posts = { ...bWritten.posts, share: shareLinks(env.origin, runId, bWritten.posts, "b") };
      await env.store.set(variantKey(runId), variantMarketingSchema.parse({ conceptId: bId, poster: bArt.poster, posts: bPosts }), { ttlSeconds: TTL.plan });
      usage = { calls: usage.calls + bWritten.usage.calls, inputTokens: usage.inputTokens + bWritten.usage.inputTokens, outputTokens: usage.outputTokens + bWritten.usage.outputTokens };
      billed += bArt.billed ? 1 : 0;
      events.push(step("Wrote variant B's poster and posts", `From the test's second concept, so the two online pushes can be compared too. ${bWritten.source === "claude" ? "Claude's drafts passed the checks" : "The plain template"}; ${bArt.poster.status === "ready" ? "its own background art" : "the plain background"}.`));
    }
    if (report.cost && (usage.calls > 0 || billed > 0)) events.push({ type: "run.cost", cost: addCost(report.cost, usage, billed) });
    events.push({ type: "stage.done", stage: "marketing", stats: { durationMs: now().getTime() - started, liveCalls: 0, cachedCalls: 0 } });
    await env.source.append(runId, events);
    return true;
  } finally {
    await env.store.deleteIfEquals(posterKeys.lock(runId), token);
  }
}

/**
 * A new version of a finished poster's background art: the same frozen prompt with a new seed
 * (lib/plan/poster-prompt.ts), so it gets its own hash, its own cache entry and its own render, within
 * the same caps as the first. The posts stay as they are. If the new art does not render, the poster
 * goes back to the one it had, with the reason in the trace. Returns false when another job holds the plan.
 */
export async function runRemake(env: MarketingEnv, runId: string, visitor: StoryboardVisitor | null, version: number): Promise<boolean> {
  const now = env.now ?? (() => new Date());
  const token = crypto.randomUUID();
  if (!(await env.store.set(posterKeys.lock(runId), token, { ifAbsent: true, ttlSeconds: MARKETING_LOCK_SECONDS }))) return false;
  try {
    const state = await env.source.state(runId);
    const report = state ? reportOf(state) : null;
    if (!report?.plan || !report.posts || !FINAL.has(report.poster.status)) return true;
    const previous = report.poster;
    const queued = queuedPoster(report, version);
    await env.source.append(runId, [
      { type: "poster.updated", poster: queued },
      step(`Asked for poster version ${version + 1}`, "The same frozen art prompt with a new seed, so only the background changes. Every word stays as code set it."),
    ]);
    const signal = env.abortSignal ? { abortSignal: env.abortSignal } : {};
    const art = await renderPosterArt({ ...env.art, store: env.store, now, ...signal }, report, visitor, version).catch(() => ({ poster: { ...queued, status: "failed" as const, reason: POSTER_REASONS.failed }, billed: false }));
    const events: PlanEventInput[] =
      art.poster.status === "ready"
        ? [{ type: "poster.updated", poster: art.poster }, step("Painted a new poster background", `${POSTER_MODEL.displayName}, version ${version + 1}.${art.billed ? "" : " From the art cache, at no cost."}`)]
        : [{ type: "poster.updated", poster: previous }, step("Kept the earlier poster", art.poster.reason ?? POSTER_REASONS.failed)];
    if (report.cost && art.billed) events.push({ type: "run.cost", cost: addCost(report.cost, { calls: 0, inputTokens: 0, outputTokens: 0 }, 1) });
    await env.source.append(runId, events);
    return true;
  } finally {
    await env.store.deleteIfEquals(posterKeys.lock(runId), token);
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
  /** A new version of the art ({ "remake": "art" }); without it, a remake is refused. */
  remake?: (store: Store, source: PlanSource, runId: string, visitor: StoryboardVisitor, version: number) => Promise<unknown>;
}

const FINAL = new Set(["ready", "skipped", "failed"]);

/** POST /api/plan/<id>/marketing's body: nothing (make the poster and posts), or a new version of the art. */
export const marketingRequestSchema = z.strictObject({ remake: z.literal("art").optional() });
export type MarketingRequest = z.infer<typeof marketingRequestSchema>;

/** One visitor's marketing requests this hour, counted; true while within the limit. */
async function withinHourly(store: Store, visitor: VisitorId | TokenVisitorId, now: number, limit: number): Promise<boolean> {
  const hour = new Date(now).toISOString().slice(0, 13);
  return (await store.incr(keys.rate("marketing", visitor, hour), { ttlSeconds: 60 * 60 + 60 })) <= limit;
}

/** The checks for a new version of the art, once the plan is known to be finished. */
async function admitRemake(deps: MarketingRouteDeps, store: Store, source: PlanSource, id: string, report: MarketingReport): Promise<RouteAnswer<MarketingResponse>> {
  if (!deps.remake) return apiError("invalid", "New versions of the poster are not available here.", 409);
  if (!report.posts || !FINAL.has(report.poster.status)) return answer(202, { status: "working", message: "The first poster is still being made." });
  if (report.poster.status === "skipped") return apiError("invalid", report.poster.reason ?? POSTER_REASONS.noService, 409);
  if (await store.get(posterKeys.lock(id))) return answer(202, { status: "working", message: null });
  const ip = await visitorId(store, deps.headers);
  if (!(await withinHourly(store, ip, deps.now?.() ?? Date.now(), deps.perVisitorHour ?? MARKETING_PER_VISITOR_HOUR))) return apiError("rate_limited", "That is a lot of posters in an hour. Try again later.");
  const version = await store.incr(posterKeys.version(id), { ttlSeconds: TTL.plan });
  if (version > MAX_POSTER_VERSIONS) {
    await store.incr(posterKeys.version(id), { by: -1 }).catch(() => undefined);
    return apiError("rate_limited", `This plan has had ${MAX_POSTER_VERSIONS} new versions of its poster. Keep the one you like best.`);
  }
  const visitor: StoryboardVisitor = { id: ip, cookie: deps.cookieVisitor ?? null };
  const remake = deps.remake;
  deps.schedule(() => remake(store, source, id, visitor, version));
  return answer(202, { status: "working", message: "A new background is being painted. Your words stay the same." });
}

export async function requestMarketing(deps: MarketingRouteDeps, id: string, request: MarketingRequest = {}): Promise<RouteAnswer<MarketingResponse>> {
  if (isExampleId(id)) return answer(200, { status: "done", message: "Examples ship with their poster and posts." });
  if (!deps.live) return apiError("off", "Live runs are off, so posters and posts are not written. The examples show theirs.");
  if (!isLivePlanId(id)) return apiError("invalid", "That is not a plan id.");
  let store: Store;
  try {
    store = deps.store();
  } catch {
    return apiError("failed", "No shared store is configured on this server.", 503);
  }
  const source = deps.source(store);
  const state = await source.state(id);
  const report = state ? reportOf(state) : null;
  if (!state || !report) return apiError("not_found", "No plan with that id (plans are kept for 45 days).");
  if (!report.plan || state.status === "running" || state.status === "idle") return apiError("busy", "The plan is still being written. The poster and posts follow it.");
  if (state.status === "failed") return apiError("invalid", "This plan did not finish, so it has no poster or posts.", 409);
  if (request.remake === "art") return admitRemake(deps, store, source, id, report);
  if (report.posts && FINAL.has(report.poster.status)) return answer(200, { status: "done", message: null });
  if (await store.get(posterKeys.lock(id))) return answer(202, { status: "working", message: null });
  const ip = await visitorId(store, deps.headers);
  if (!(await withinHourly(store, ip, deps.now?.() ?? Date.now(), deps.perVisitorHour ?? MARKETING_PER_VISITOR_HOUR))) return apiError("rate_limited", "That is a lot of posters in an hour. Try again later.");
  const visitor: StoryboardVisitor = { id: ip, cookie: deps.cookieVisitor ?? null };
  deps.schedule(() => deps.job(store, source, id, visitor));
  return answer(202, { status: "working", message: null });
}

// --- The automatic start, right after a live plan finishes ------------------------------------------

/** The marketing job needs about this long (the posts' Claude call and the art run side by side). */
export const AUTO_MARKETING_MIN_MS = 100_000;

export type AutoMarketingOutcome = "started" | "done" | "working" | "not-ready" | "rate-limited" | "no-time";

export interface AutoMarketingDeps {
  store: Store;
  source: PlanSource;
  /** Who started the plan (its meta's salted id), counted against the same hourly limit as the route. */
  visitor: VisitorId | TokenVisitorId | null;
  /** How long the invocation has left; below AUTO_MARKETING_MIN_MS the start is left to the page. */
  remainingMs: number;
  perVisitorHour?: number;
  now?: () => number;
  job: (store: Store, source: PlanSource, runId: string, visitor: StoryboardVisitor | null, deadlineMs: number) => Promise<unknown>;
}

/**
 * Starts a finished live plan's poster and posts on the server, in the same background invocation as
 * the plan, so they are ready by the time the manager opens the Poster step. The same checks as the
 * route: a finished plan with no poster and posts yet, the lock (a page that also asks never makes a
 * second set), and the starter's hourly limit; the art job keeps its own daily caps. When the
 * invocation has too little time left, nothing starts here and the page asks the route instead.
 */
export async function autoMarketing(deps: AutoMarketingDeps, runId: string): Promise<AutoMarketingOutcome> {
  const { store, source } = deps;
  const state = await source.state(runId);
  const report = state ? reportOf(state) : null;
  if (!state || !report?.plan || (state.status !== "done" && state.status !== "partial")) return "not-ready";
  if (report.posts && FINAL.has(report.poster.status)) return "done";
  if (await store.get(posterKeys.lock(runId))) return "working";
  if (deps.remainingMs < AUTO_MARKETING_MIN_MS) return "no-time";
  if (deps.visitor && !(await withinHourly(store, deps.visitor, deps.now?.() ?? Date.now(), deps.perVisitorHour ?? MARKETING_PER_VISITOR_HOUR))) return "rate-limited";
  await deps.job(store, source, runId, deps.visitor ? { id: deps.visitor, cookie: null } : null, deps.remainingMs - 10_000);
  return "started";
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
  // On the Blob store, only the objects the art job writes (posters/<promptHash>.<ext>).
  if (/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(parsed.hostname)) return /^\/posters\/[0-9a-f]{64}\.(?:png|jpg|webp)$/.test(parsed.pathname);
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
  /** An example's approved art, read from its marketing folder (lib/plan/poster-approval.ts). */
  exampleArt?: (slug: string) => PosterArt | null;
  /** An example's approval, for its variant B posts. */
  exampleApproval?: (slug: string) => PosterApproval | null;
}

/** A live poster's art: its rendered background, by its prompt hash in the art cache (poster.url is not used for it). */
async function cachedArtUrl(store: Store | null, promptHash: string): Promise<string | null> {
  if (!store || !promptHash) return null;
  try {
    const hit = await store.get<{ url?: unknown }>(posterKeys.render(promptHash));
    return typeof hit?.url === "string" ? hit.url : null;
  } catch {
    return null;
  }
}

export { sniffImage };

async function fetchArt(url: string, fetchImpl: typeof fetch): Promise<PosterArt | null> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(ART_FETCH_TIMEOUT_MS), redirect: "error" });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!response.ok || !ART_TYPES.has(type) || !response.body) return null;
    if (Number(response.headers.get("content-length")) > ART_MAX_BYTES) return null;
    // Read with a cap, whatever content-length said.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ART_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const sniffed = sniffImage(bytes);
    if (!sniffed) return null;
    return { dataUri: `data:${sniffed};base64,${bytes.toString("base64")}` };
  } catch {
    return null;
  }
}

/** The store, or null where none is configured (examples still read their recordings). */
function storeOrNull(deps: PosterRouteDeps): Store | null {
  try {
    return deps.store();
  } catch {
    return null;
  }
}

async function findReport(deps: PosterRouteDeps, id: string): Promise<{ report: MarketingReport; store: Store | null } | null> {
  const example = isExampleId(id);
  if (!example && !(deps.live && isLivePlanId(id))) return null;
  const store = storeOrNull(deps);
  if (!example && !store) return null;
  // A store that cannot answer reads as no plan: a 404, never a broken image.
  const state = await deps.source(store).state(id).catch(() => null);
  const report = state ? reportOf(state) : null;
  return report ? { report, store } : null;
}

const notFound = () => Response.json({ error: { code: "not_found", message: "No plan with that id." } }, { status: 404, headers: { "cache-control": "no-store" } });

/** Both variants' posters and posts, for the plan page and the share screen. */
export async function marketingState(deps: PosterRouteDeps, id: string): Promise<Response> {
  const found = await findReport(deps, id);
  if (!found) return notFound();
  const { report, store } = found;
  const bId = variantBConcept(report);
  const slug = planExampleSlug(id);
  // An example's variant B is what the founder approved with it; a live plan's is in the store.
  const approvedB = slug ? (deps.exampleApproval ?? readApproval)(slug)?.variantB : undefined;
  const stored = slug ? (approvedB ? { conceptId: approvedB.conceptId, poster: approvedB.poster, posts: approvedB.posts } : null) : await readVariant(store, id);
  const b = bId ? (stored ?? { conceptId: bId, poster: { status: "none", prompt: "", promptHash: "", alt: "" } satisfies Poster, posts: null }) : null;
  const body = marketingStateSchema.parse({ a: { conceptId: report.plan?.conceptId ?? null, poster: report.poster, posts: report.posts }, b: b && b.conceptId === bId ? b : null });
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

/** The composited poster PNG (variant B's with `variant: "b"`), or a 404 for an unknown plan. Never an error image. */
export async function posterResponse(deps: PosterRouteDeps, id: string, size: PosterSize, variant: "a" | "b" = "a"): Promise<Response> {
  const found = await findReport(deps, id);
  if (!found) return notFound();
  let { report } = found;
  let poster: Poster = report.poster;
  if (variant === "b") {
    const bId = variantBConcept(report);
    if (!bId) return notFound();
    const stored = await readVariant(found.store, id);
    report = withFrontConcept(report, bId);
    poster = stored?.conceptId === bId ? stored.poster : { status: "none", prompt: "", promptHash: "", alt: "" };
  }
  const example = report.meta.kind === "example";
  const slug = planExampleSlug(id);
  let art: PosterArt | null = null;
  if (example && slug) {
    // An example draws only art the founder approved, read from disk and checked by its sha256. Variant B has none.
    if (variant === "a") art = (deps.exampleArt ?? loadApprovedArt)(slug);
  } else if (poster.status === "ready") {
    const url = poster.url ?? (await cachedArtUrl(found.store, poster.promptHash));
    art = url && trustedArtUrl(url, deps.artOrigins) ? await fetchArt(url, deps.fetch ?? globalThis.fetch) : null;
  }
  const settled = example || FINAL.has(poster.status);
  // A poster whose art could not be read this time is never cached, so the next request tries again.
  const cache = !settled || (!example && poster.status === "ready" && !art) ? "no-store" : example ? "public, max-age=3600, s-maxage=86400" : "public, max-age=300, s-maxage=3600";
  return posterImage(posterText(report), art, size, { "cache-control": cache });
}
