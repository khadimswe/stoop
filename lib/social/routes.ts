// The social routes' handlers, with their vendors passed in, so each is tested with a MemoryStore, a
// fake fetch and plain Requests:
// - GET  /api/social/meta/start      redirects to Facebook's login dialog with a signed state
// - GET  /api/social/meta/callback   checks the state, swaps the code for tokens and stores them, sealed
// - GET  /api/social/meta/pages      the connected Pages: names, ids, whether Instagram is linked
// - POST /api/social/meta/disconnect deletes the stored tokens
// - POST /api/plan/[id]/social/post  posts the plan's poster with that channel's approved caption
// - GET  /api/plan/[id]/social/poster.jpg  the poster as a JPEG, the format Instagram fetches
// Everything answers 404 unless ENABLE_META_POSTING is on and the app keys and signing secret are set
// (the page then keeps its one-tap share links). Nothing posts without the manager's own POST; example
// plans never post; captions are the approved drafts, checked again; tokens never reach a response or a
// log line, and neither does a Meta response body.
import { allowAll, type BotCheck } from "../bot-check";
import { apiError, BodyError, json, MESSAGES, rateLimited, readCookie, readJson } from "../http";
import { isExampleId, isLivePlanId, reportOf, type PlanSource } from "../plan/posts-store";
import { hitRate, type RateRule } from "../rate-limit";
import { browserOnly } from "../routes/guard";
import { dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { visitorId } from "../store/visitor";
import { META_RETURN_PARAM, socialPagesResponseSchema, socialPostRequestSchema, socialPostResponseSchema, type MetaOutcome, type SocialPostResult } from "./api";
import { exchangeCode, inScheduleWindow, listPages, longLivedUserToken, META_ERROR_MESSAGES, MetaError, oauthUrl, postPagePhoto, publishInstagramImage, type Fetch, type MetaApp, type MetaCall } from "./meta";
import { approvedCaption, checkApprovedPosts } from "./posts-guard";
import { storeTimeZone } from "./schedule";
import {
  connectionTtlSeconds,
  cookie,
  deleteConnection,
  loadConnection,
  META_SESSION_COOKIE,
  META_SESSION_PATH,
  META_STATE_COOKIE,
  META_STATE_PATH,
  mintSession,
  mintState,
  safeReturnPath,
  saveConnection,
  sessionOf,
  STATE_TTL_SECONDS,
  verifyState,
} from "./session";
import { SOCIAL_CHANNEL_LABELS, socialLabel, socialStep, type SocialChannel } from "./trail";

if (typeof window !== "undefined") {
  throw new Error("lib/social/routes runs on the server only.");
}

/** Logins started per IP per hour. */
export const META_START_RULE: RateRule = { name: "meta-start", limit: 20, windowSeconds: 60 * 60 };
/** Channel posts one connection may make in a day. */
export const META_POSTS_PER_SESSION_DAILY = 10;
/** Channel posts to one Page in a day, however many times it is connected. */
export const META_POSTS_PER_PAGE_DAILY = 10;
/** Channel posts across every connection in a day. */
export const META_POSTS_DAILY = 100;
/** A plan posts to one Page channel once a day ("now"), and once per scheduled minute. */
const POSTED_TTL_SECONDS = 24 * 60 * 60;
/**
 * When Meta did not answer clearly (a timeout, a network error, a 5xx), the post may have gone out, so
 * the hold stays this long and the manager is asked to check the Page before trying again.
 */
export const UNCLEAR_HOLD_SECONDS = 30 * 60;
const FINAL_POSTER = new Set(["ready", "skipped", "failed"]);

export interface SocialDeps {
  /** ENABLE_META_POSTING. */
  enabled: boolean;
  /** META_APP_ID and META_APP_SECRET (and META_CONFIG_ID), or null. */
  app: MetaApp | null;
  /** STOOP_SIGNING_SECRET, or null. */
  secret: string | null;
  /** JUDGING_ENDS_AT, epoch ms: connections end then. */
  until: number;
  store: () => Store;
  source: (store: Store) => PlanSource;
  fetch: Fetch;
  /** The plan's composited poster PNG (1080 by 1350), drawn in process, or null when there is none. */
  poster: (planId: string) => Promise<Uint8Array | null>;
  /** PNG to JPEG, for Instagram. */
  toJpeg: (png: Uint8Array) => Promise<Uint8Array>;
  botCheck?: () => BotCheck;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type On = { app: MetaApp; secret: string; until: number };

/** The feature's config, or null while it is off: the flag, the app keys, the signing secret, and judging not over. */
function on(deps: SocialDeps): On | null {
  if (!deps.enabled || !deps.app || !deps.secret || (deps.now?.() ?? Date.now()) >= deps.until) return null;
  return { app: deps.app, secret: deps.secret, until: deps.until };
}

const notFound = () => apiError("not_found", "Not found.", 404);
const nowOf = (deps: SocialDeps) => deps.now?.() ?? Date.now();
/**
 * A Graph call's vendors. Only reads take the request's signal: a call that creates a post is never cut
 * off by the manager closing the tab, so Stoop always learns whether it went out.
 */
const callOf = (deps: SocialDeps, app: MetaApp, signal?: AbortSignal): MetaCall => ({ fetch: deps.fetch, app, ...(signal ? { signal } : {}) });

function storeOrNull(deps: SocialDeps): Store | null {
  try {
    return deps.store();
  } catch {
    return null;
  }
}

/** Where Facebook sends the manager back: this host's callback, the same for the dialog and the exchange. */
export const redirectUri = (request: Request) => `${new URL(request.url).origin}/api/social/meta/callback`;

const metaLog = (what: string, error: unknown) =>
  console.error(`${what}: ${error instanceof MetaError ? `${error.kind}${error.code !== null ? ` ${error.code}` : ""}${error.subcode !== null ? `/${error.subcode}` : ""}` : error instanceof Error ? error.name : "error"}`);

// --- GET /api/social/meta/start -----------------------------------------------------------------

export async function startConnect(request: Request, deps: SocialDeps): Promise<Response> {
  const config = on(deps);
  if (!config) return notFound();
  const store = storeOrNull(deps);
  if (!store) return apiError("failed", MESSAGES.storeDown, 503);
  const rate = await hitRate(store, META_START_RULE, await visitorId(store, request.headers), nowOf(deps));
  if (!rate.ok) return rateLimited(rate.retryAfterSeconds);
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return"));
  const { state, nonce } = mintState(config.secret, returnTo, nowOf(deps));
  const headers = new Headers({ location: oauthUrl(config.app, redirectUri(request), state), "cache-control": "no-store", "referrer-policy": "no-referrer" });
  headers.append("set-cookie", cookie(request, META_STATE_COOKIE, nonce, STATE_TTL_SECONDS, META_STATE_PATH));
  return new Response(null, { status: 303, headers });
}

// --- GET /api/social/meta/callback --------------------------------------------------------------

/** Back to the page the manager came from, with ?meta=<outcome> for the page to say what happened. */
function back(request: Request, path: string, outcome: MetaOutcome, cookies: string[]): Response {
  const url = new URL(path, new URL(request.url).origin);
  url.searchParams.set(META_RETURN_PARAM, outcome);
  const headers = new Headers({ location: url.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
}

export async function connectCallback(request: Request, deps: SocialDeps): Promise<Response> {
  const config = on(deps);
  if (!config) return notFound();
  const now = nowOf(deps);
  const query = new URL(request.url).searchParams;
  const clearState = cookie(request, META_STATE_COOKIE, "", 0, META_STATE_PATH);
  const verified = verifyState(config.secret, query.get("state"), readCookie(request, META_STATE_COOKIE), now);
  if (!verified) return back(request, "/", "expired", [clearState]);
  const code = query.get("code");
  if (query.get("error") || !code) return back(request, verified.returnTo, query.get("error") === "access_denied" ? "denied" : "failed", [clearState]);
  const store = storeOrNull(deps);
  const ttl = connectionTtlSeconds(config.until, now);
  if (!store || ttl <= 0) return back(request, verified.returnTo, "failed", [clearState]);
  try {
    const call = callOf(deps, config.app, request.signal);
    const short = await exchangeCode(call, code, redirectUri(request), now);
    // A long-lived user token (about 60 days) makes Page tokens that do not expire; the short one still works for now.
    const user = await longLivedUserToken(call, short.token, now).catch((error: unknown) => {
      metaLog("Meta long-lived token failed", error);
      return short;
    });
    const pages = await listPages(call, user.token);
    const previous = sessionOf(request, config.secret);
    if (previous) await deleteConnection(store, previous);
    const session = mintSession(config.secret);
    await saveConnection(store, config.secret, session.id, { v: 1, user: { token: user.token, expiresAt: user.expiresAt }, pages, connectedAt: new Date(now).toISOString() }, ttl);
    return back(request, verified.returnTo, "connected", [clearState, cookie(request, META_SESSION_COOKIE, session.value, ttl, META_SESSION_PATH)]);
  } catch (error) {
    metaLog("Meta connect failed", error);
    return back(request, verified.returnTo, "failed", [clearState]);
  }
}

// --- GET /api/social/meta/pages ------------------------------------------------------------------

const clearSession = (request: Request) => cookie(request, META_SESSION_COOKIE, "", 0, META_SESSION_PATH);
const notConnected = (request: Request, clear: boolean) => {
  const response = json(socialPagesResponseSchema.parse({ connected: false, pages: [] }));
  if (clear) response.headers.append("set-cookie", clearSession(request));
  return response;
};

export async function connectedPages(request: Request, deps: SocialDeps): Promise<Response> {
  const config = on(deps);
  if (!config) return notFound();
  if (request.headers.get("sec-fetch-site") === "cross-site") return apiError("invalid", MESSAGES.crossSite, 403);
  const id = sessionOf(request, config.secret);
  if (!id) return notConnected(request, false);
  const store = storeOrNull(deps);
  if (!store) return apiError("failed", MESSAGES.storeDown, 503);
  const connection = await loadConnection(store, config.secret, id);
  if (!connection) return notConnected(request, true);
  return json(
    socialPagesResponseSchema.parse({
      connected: true,
      pages: connection.pages.map((p) => ({ id: p.id, name: p.name, canPost: p.canPost, instagram: p.instagram ? { username: p.instagram.username } : null })),
    }),
  );
}

// --- POST /api/social/meta/disconnect -------------------------------------------------------------

export async function disconnect(request: Request, deps: SocialDeps): Promise<Response> {
  const config = on(deps);
  if (!config) return notFound();
  const refused = await browserOnly(request, deps.botCheck ?? (() => allowAll));
  if (refused) return refused;
  const id = sessionOf(request, config.secret);
  if (id) {
    const store = storeOrNull(deps);
    if (!store) return apiError("failed", MESSAGES.storeDown, 503);
    await deleteConnection(store, id);
  }
  return notConnected(request, true);
}

// --- POST /api/plan/[id]/social/post ----------------------------------------------------------------

const result = (channel: SocialChannel, status: SocialPostResult["status"], message: string, extra: Partial<Pick<SocialPostResult, "link" | "error">> = {}): SocialPostResult => ({
  channel,
  status,
  message: message.slice(0, 300),
  link: extra.link ?? null,
  error: extra.error ?? null,
});

const INSTAGRAM_NO_SCHEDULE = "Instagram's API cannot schedule posts. Post it to Instagram now, or schedule it in the Instagram app.";

export async function postToMeta(request: Request, planId: string, deps: SocialDeps): Promise<Response> {
  const config = on(deps);
  if (!config) return notFound();
  if (isExampleId(planId)) return apiError("invalid", "Example plans never post. Start a plan for your store to post its poster.", 403);
  if (!isLivePlanId(planId)) return apiError("not_found", "No plan with that id.", 404);
  const refused = await browserOnly(request, deps.botCheck ?? (() => allowAll));
  if (refused) return refused;
  let body: unknown;
  try {
    body = await readJson(request, 2_048);
  } catch (error) {
    if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
    throw error;
  }
  const parsed = socialPostRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid", parsed.error.issues[0]?.message ?? "That request is not valid.", 400);
  const { pageId, channels, when } = parsed.data;

  const sessionId = sessionOf(request, config.secret);
  if (!sessionId) return apiError("invalid", "Connect Facebook first.", 401);
  const store = storeOrNull(deps);
  if (!store) return apiError("failed", MESSAGES.storeDown, 503);
  const connection = await loadConnection(store, config.secret, sessionId);
  if (!connection) return apiError("invalid", "Your Facebook connection ended. Connect Facebook again.", 401);
  const page = connection.pages.find((p) => p.id === pageId);
  if (!page) return apiError("not_found", "That is not one of the Pages you connected.", 404);

  const source = deps.source(store);
  const state = await source.state(planId);
  const report = state ? reportOf(state) : null;
  if (!state || !report) return apiError("not_found", "No plan with that id (plans are kept for 30 days).", 404);
  if (state.status === "failed") return apiError("invalid", "This plan did not finish, so it has nothing to post.", 409);
  if (state.status === "running" || state.status === "idle" || !report.posts || !FINAL_POSTER.has(report.poster.status)) return apiError("busy", "The poster and posts are not ready yet. Make them first, then post.", 409);
  const posts = report.posts;

  const now = nowOf(deps);
  const scheduleAt = when === "now" ? null : new Date(when);
  if (scheduleAt && !inScheduleWindow(scheduleAt, now)) return apiError("invalid", META_ERROR_MESSAGES.schedule, 400);

  // The posts guard once more, on exactly what would go out.
  const issues = checkApprovedPosts(posts, report, channels);
  if (issues.length > 0) return apiError("invalid", `The approved draft no longer passes Stoop's checks, so nothing was posted. ${issues[0]!.message}`, 422);

  const results = new Map<SocialChannel, SocialPostResult>();
  const go: SocialChannel[] = [];
  for (const channel of channels) {
    if (channel === "instagram" && !page.instagram) results.set(channel, result(channel, "skipped", META_ERROR_MESSAGES.not_linked, { error: "not_linked" }));
    else if (channel === "instagram" && scheduleAt) results.set(channel, result(channel, "skipped", INSTAGRAM_NO_SCHEDULE, { error: "schedule" }));
    else if (channel === "facebook" && !page.canPost) results.set(channel, result(channel, "skipped", META_ERROR_MESSAGES.permission, { error: "permission" }));
    else go.push(channel);
  }

  // One post per Page channel per time: a second tap finds the first one's hold.
  const slot = scheduleAt ? scheduleAt.toISOString().slice(0, 16) : "now";
  const held: SocialChannel[] = [];
  for (const channel of go) {
    const fresh = await store.set(keys.social.metaPosted(planId, page.id, channel, slot), now, { ifAbsent: true, ttlSeconds: POSTED_TTL_SECONDS });
    if (fresh) held.push(channel);
    else results.set(channel, result(channel, "skipped", scheduleAt ? `Already scheduled on ${SOCIAL_CHANNEL_LABELS[channel]} for that time.` : `Already posted to ${SOCIAL_CHANNEL_LABELS[channel]} from Stoop today.`));
  }
  const release = (channel: SocialChannel) => store.del(keys.social.metaPosted(planId, page.id, channel, slot)).catch(() => undefined);

  if (held.length > 0) {
    const day = dayOf(now);
    const by = held.length;
    const counters = [
      { key: keys.social.metaSessionPosts(sessionId, day), cap: META_POSTS_PER_SESSION_DAILY },
      { key: keys.social.metaPagePosts(page.id, day), cap: META_POSTS_PER_PAGE_DAILY },
      { key: keys.daily("meta-posts", day), cap: META_POSTS_DAILY },
    ];
    const counts = [];
    for (const { key } of counters) counts.push(await store.incr(key, { by, ttlSeconds: TTL.daily }));
    if (counts.some((count, i) => count > counters[i]!.cap)) {
      for (const { key } of counters) await store.incr(key, { by: -by });
      await Promise.all(held.map(release));
      const global = counts[2]! > META_POSTS_DAILY;
      return apiError("rate_limited", global ? "Stoop has posted a lot today. Try again tomorrow, or use one-tap share." : "That is a lot of posts for one day. Try again tomorrow.", 429);
    }
  }

  // No request signal: a post that started is never cut off half way (see callOf).
  const call = callOf(deps, config.app);
  const zone = storeTimeZone(report.inputs.store);
  const at = scheduleAt ?? new Date(now);
  const trail: SocialChannel[] = [];
  for (const channel of held) {
    try {
      if (channel === "facebook") {
        const png = await deps.poster(planId);
        if (!png) throw new MetaError("image", "The poster image could not be drawn. Try again in a moment.");
        const photo = await postPagePhoto(call, { id: page.id, token: page.token }, { caption: approvedCaption(posts, "facebook"), image: { bytes: png, contentType: "image/png", filename: "poster.png" }, scheduleAt }, now);
        results.set(channel, result(channel, scheduleAt ? "scheduled" : "posted", socialLabel(channel, scheduleAt ? "scheduled" : "posted", at, zone), { link: !scheduleAt && photo.postId ? `https://www.facebook.com/${photo.postId}` : null }));
      } else {
        const imageUrl = `${new URL(request.url).origin}/api/plan/${encodeURIComponent(planId)}/social/poster.jpg`;
        const media = await publishInstagramImage(
          call,
          { igUserId: page.instagram!.id, tokens: [page.token, connection.user.token] },
          { imageUrl, caption: approvedCaption(posts, "instagram"), aiGenerated: report.poster.status === "ready" },
          deps.sleep ? { sleep: deps.sleep } : {},
        );
        const label = socialLabel(channel, "posted", new Date(nowOf(deps)), zone);
        results.set(channel, result(channel, "posted", media.note ? `${label}. ${media.note}` : label, { link: media.permalink }));
      }
      trail.push(channel);
    } catch (error) {
      metaLog(`Meta ${channel} post failed`, error);
      if (error instanceof MetaError && error.kind !== "unavailable") {
        // Meta clearly refused (or nothing was sent): the slot is free for a retry.
        await release(channel);
        results.set(channel, result(channel, "failed", error.message, { error: error.kind }));
      } else {
        // No clear answer: it may have posted. Hold the slot a while, so a second tap cannot post it twice.
        await store.set(keys.social.metaPosted(planId, page.id, channel, slot), now, { ttlSeconds: UNCLEAR_HOLD_SECONDS }).catch(() => undefined);
        const where = channel === "facebook" ? "the Page" : "the Instagram account";
        results.set(channel, result(channel, "failed", `${SOCIAL_CHANNEL_LABELS[channel]} did not confirm the post. Check ${where} first: if it is not there, try again in 30 minutes.`, { error: "unavailable" }));
      }
    }
  }

  // The plan's own record: one trace step per channel Meta confirmed. A failed write never undoes a post.
  if (trail.length > 0) {
    const steps = trail.map((channel) => socialStep(channel, scheduleAt ? "scheduled" : "posted", channel === "instagram" ? new Date(nowOf(deps)) : at, zone));
    await source.append(planId, steps.map((step) => ({ type: "trace.step" as const, step }))).catch((error: unknown) => metaLog("Social trail write failed", error));
  }
  return json(socialPostResponseSchema.parse({ results: channels.map((c) => results.get(c)!) }));
}

// --- GET /api/plan/[id]/social/poster.jpg -------------------------------------------------------------

/** The poster as a JPEG for Instagram's servers to fetch (Instagram takes JPEG only). Live plans only. */
export async function posterJpeg(planId: string, deps: SocialDeps): Promise<Response> {
  if (!on(deps) || !isLivePlanId(planId)) return notFound();
  const png = await deps.poster(planId).catch(() => null);
  if (!png) return notFound();
  const jpeg = await deps.toJpeg(png);
  return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
}
