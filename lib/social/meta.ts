// The Meta adapter, for posting a plan's poster to the manager's own Facebook Page and Instagram
// account: Facebook Login (the dialog URL, the code-for-token exchange and a long-lived user token),
// the Pages the person manages with their Page tokens and any linked Instagram professional account,
// a photo post to a Page (now, or scheduled 10 minutes to 30 days ahead) and a two-step Instagram
// image publish from a public image URL. Plain fetch, passed in, so tests run it against a fake.
// Server only: every call with a token carries appsecret_proof, and errors carry Stoop's own words and
// Meta's numeric codes, never a response body (a body may echo what was sent).
//
// Checked against Meta's docs on Oct 28, 2026, Graph API v26.0 (released July 29, 2026):
// - https://developers.facebook.com/docs/graph-api/changelog (v26.0 is the latest version)
// - https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow (dialog, state, code exchange)
// - https://developers.facebook.com/docs/facebook-login/facebook-login-for-business (config_id in place of scope)
// - https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived (fb_exchange_token; Page tokens from /accounts)
// - https://developers.facebook.com/docs/graph-api/reference/page/photos/ (url or source, caption, published, scheduled_publish_time; returns id and post_id)
// - https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed (scheduled_publish_time: 10 minutes to 75 days ahead;
//   the Pages API guide, https://developers.facebook.com/docs/pages-api/posts, says 30 days, so Stoop keeps to 30)
// - https://developers.facebook.com/docs/instagram-platform/content-publishing/ (container, status_code, media_publish; JPEG only,
//   fetched by Meta from a public server; 100 API posts per 24 hours; graph.facebook.com for Facebook Login)
// - https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media (caption up to 2,200
//   characters and 30 hashtags, is_ai_generated, containers expire after 24 hours, no scheduling parameter)
// - https://developers.facebook.com/docs/graph-api/securing-requests (appsecret_proof: HMAC-SHA256 of the token, keyed by the app secret)
import { createHmac } from "node:crypto";
import { z } from "zod";
import { checkUrl } from "../intake/address";
import { META_ERROR_KINDS, type MetaErrorKind } from "./api";
import { SCHEDULE_MAX_MS, SCHEDULE_MIN_MS } from "./schedule";

if (typeof window !== "undefined") {
  throw new Error("lib/social/meta runs on the server only.");
}

export const GRAPH_VERSION = "v26.0";
export const GRAPH_ORIGIN = "https://graph.facebook.com";
export const LOGIN_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

/** What Stoop asks for: list the Pages, post to them, and publish to their linked Instagram accounts. */
export const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"] as const;

export { SCHEDULE_MAX_MS, SCHEDULE_MIN_MS };
export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAGS_MAX = 30;
/** One Graph call's time limit. */
export const META_TIMEOUT_MS = 20_000;
/** Instagram container checks before publishing (Meta suggests checking for up to 5 minutes; an image is usually ready at once). */
export const INSTAGRAM_STATUS_CHECKS = 5;
export const INSTAGRAM_STATUS_WAIT_MS = 2_000;

type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = typeof fetch;

export interface MetaApp {
  appId: string;
  appSecret: string;
  /** A Facebook Login for Business configuration (META_CONFIG_ID): when set, it carries the permissions instead of `scope`. */
  configId: string | null;
}

/** The Meta app from META_APP_ID and META_APP_SECRET, or null when either is missing (posting stays off). */
export function metaApp(env: Env = process.env): MetaApp | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !/^\d{5,25}$/.test(appId) || !appSecret || appSecret.length < 16) return null;
  const configId = env.META_CONFIG_ID?.trim();
  return { appId, appSecret, configId: configId && /^\d{5,25}$/.test(configId) ? configId : null };
}

// --- Errors -------------------------------------------------------------------------------------

export { META_ERROR_KINDS, type MetaErrorKind };

export const META_ERROR_MESSAGES: Readonly<Record<MetaErrorKind, string>> = {
  auth: "Facebook ended this connection. Connect Facebook again.",
  permission: "Facebook did not allow this post. Connect again and allow every permission, and check that you can post on this Page.",
  rate_limited: "Facebook says this account is posting too often. Try again in a while.",
  image: "Meta could not read the poster image.",
  invalid: "Facebook did not accept this post.",
  unavailable: "Facebook did not answer. Try again in a moment.",
  not_linked: "This Page has no Instagram professional account linked to it.",
  schedule: "A scheduled post has to be 10 minutes to 30 days ahead.",
};

/** A typed failure: `kind` says what the manager can do; `code` and `subcode` are Meta's numbers, for the logs. */
export class MetaError extends Error {
  override name = "MetaError";
  constructor(
    readonly kind: MetaErrorKind,
    message: string = META_ERROR_MESSAGES[kind],
    readonly code: number | null = null,
    readonly subcode: number | null = null,
  ) {
    super(message);
  }
}

/** Meta's error codes, by what they mean for the manager (https://developers.facebook.com/docs/graph-api/guides/error-handling). */
export function classifyMetaError(status: number, code: number | null, subcode: number | null): MetaErrorKind {
  if (code === 190 || code === 102 || (code === 100 && subcode === 36007)) return "auth";
  if (code === 10 || code === 3 || (code !== null && code >= 200 && code <= 299)) return "permission";
  if (code === 4 || code === 17 || code === 32 || code === 368 || code === 613 || status === 429) return "rate_limited";
  if (code === 9004 || code === 36001 || code === 36003 || (subcode !== null && [2207003, 2207004, 2207005, 2207009, 2207026, 2207052].includes(subcode))) return "image";
  if (status >= 500 || code === 1 || code === 2) return "unavailable";
  return "invalid";
}

// --- Graph calls ----------------------------------------------------------------------------------

export interface MetaCall {
  fetch: Fetch;
  app: MetaApp;
  signal?: AbortSignal;
}

/** Proves the call comes from this app's server: a stolen token alone cannot call with it. */
export function appSecretProof(app: MetaApp, token: string): string {
  return createHmac("sha256", app.appSecret).update(token).digest("hex");
}

const errorBody = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }).loose() }).loose();

async function graph<T>(call: MetaCall, schema: z.ZodType<T>, method: "GET" | "POST", path: string, params: Record<string, string>, token: string | null, form?: FormData): Promise<T> {
  const auth: Record<string, string> = token ? { access_token: token, appsecret_proof: appSecretProof(call.app, token) } : {};
  const url = new URL(`${GRAPH_ORIGIN}/${GRAPH_VERSION}/${path}`);
  let body: BodyInit | undefined;
  if (method === "GET") {
    for (const [name, value] of Object.entries({ ...params, ...auth })) url.searchParams.set(name, value);
  } else if (form) {
    for (const [name, value] of Object.entries({ ...params, ...auth })) form.set(name, value);
    body = form;
  } else {
    // Tokens go in the body of a POST, never in its URL.
    body = new URLSearchParams({ ...params, ...auth });
  }
  const signals = [AbortSignal.timeout(META_TIMEOUT_MS), ...(call.signal ? [call.signal] : [])];
  let response: Response;
  try {
    response = await call.fetch(url, { method, ...(body ? { body } : {}), signal: AbortSignal.any(signals), redirect: "error", cache: "no-store" });
  } catch {
    throw new MetaError("unavailable");
  }
  const data: unknown = await response.json().catch(() => null);
  const failed = errorBody.safeParse(data);
  if (!response.ok || failed.success) {
    const code = failed.success ? (failed.data.error.code ?? null) : null;
    const subcode = failed.success ? (failed.data.error.error_subcode ?? null) : null;
    throw new MetaError(classifyMetaError(response.status, code, subcode), undefined, code, subcode);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new MetaError("unavailable", "Facebook answered in a way Stoop did not expect. Try again in a moment.");
  return parsed.data;
}

const graphId = /^\d{1,30}$/;
function assertId(id: string, what: string): void {
  if (!graphId.test(id)) throw new MetaError("invalid", `That is not a ${what} id.`);
}

// --- Facebook Login -------------------------------------------------------------------------------

/**
 * The login dialog: the app, where Facebook sends the person back, a signed `state`, and the code flow.
 * Without a Login for Business configuration the permissions go in `scope`; with one, it carries them.
 */
export function oauthUrl(app: MetaApp, redirectUri: string, state: string): string {
  const url = new URL(LOGIN_DIALOG);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (app.configId) url.searchParams.set("config_id", app.configId);
  else url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().nonnegative().optional() }).loose();

export interface UserToken {
  token: string;
  /** Epoch ms, or null when Meta gave no lifetime. */
  expiresAt: number | null;
}

const userToken = (data: z.infer<typeof tokenSchema>, now: number): UserToken => ({ token: data.access_token, expiresAt: data.expires_in ? now + data.expires_in * 1000 : null });

/** The code from the redirect, for a short-lived user token. `redirectUri` must be the one the dialog was opened with. */
export async function exchangeCode(call: MetaCall, code: string, redirectUri: string, now: number = Date.now()): Promise<UserToken> {
  if (!code || code.length > 2048) throw new MetaError("invalid", "Facebook sent no login code.");
  const data = await graph(call, tokenSchema, "GET", "oauth/access_token", { client_id: call.app.appId, client_secret: call.app.appSecret, redirect_uri: redirectUri, code }, null);
  return userToken(data, now);
}

/** A short-lived user token, for a long-lived one (about 60 days). Page tokens read with it do not expire. */
export async function longLivedUserToken(call: MetaCall, shortToken: string, now: number = Date.now()): Promise<UserToken> {
  const data = await graph(call, tokenSchema, "GET", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: call.app.appId, client_secret: call.app.appSecret, fb_exchange_token: shortToken }, null);
  return userToken(data, now);
}

// --- Pages ------------------------------------------------------------------------------------------

export interface MetaPage {
  id: string;
  name: string;
  /** The Page access token. Server side only. */
  token: string;
  /** Whether the person can create content on the Page (Meta's CREATE_CONTENT task), when Meta says. */
  canPost: boolean;
  /** The linked Instagram professional account, when there is one. */
  instagram: { id: string; username: string | null } | null;
}

const pagesSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string().regex(graphId),
          name: z.string().min(1),
          access_token: z.string().min(1).optional(),
          tasks: z.array(z.string()).optional(),
          instagram_business_account: z.object({ id: z.string().regex(graphId), username: z.string().optional() }).loose().optional(),
        })
        .loose(),
    ),
  })
  .loose();

/** The Pages the person manages, with their Page tokens and linked Instagram accounts (at most 100). */
export async function listPages(call: MetaCall, userAccessToken: string): Promise<MetaPage[]> {
  const read = (fields: string) => graph(call, pagesSchema, "GET", "me/accounts", { fields, limit: "100" }, userAccessToken);
  let data: z.infer<typeof pagesSchema>;
  try {
    data = await read("id,name,access_token,tasks,instagram_business_account{id,username}");
  } catch (error) {
    // Without the Instagram permissions the nested field is refused: list the Pages without it.
    if (!(error instanceof MetaError) || error.kind !== "permission") throw error;
    data = await read("id,name,access_token,tasks");
  }
  return data.data.flatMap((page) =>
    page.access_token
      ? [
          {
            id: page.id,
            name: page.name.slice(0, 120),
            token: page.access_token,
            canPost: page.tasks ? page.tasks.includes("CREATE_CONTENT") : true,
            instagram: page.instagram_business_account ? { id: page.instagram_business_account.id, username: page.instagram_business_account.username?.slice(0, 60) ?? null } : null,
          },
        ]
      : [],
  );
}

// --- A photo post to a Page -------------------------------------------------------------------------

export interface PhotoPost {
  /** Exactly the approved text: never rewritten here. */
  caption: string;
  /** The poster's bytes, uploaded as the photo (so it works even where the site is not public). */
  image: { bytes: Uint8Array; contentType: "image/png" | "image/jpeg"; filename: string };
  /** Null posts now; a time 10 minutes to 30 days ahead schedules it. */
  scheduleAt: Date | null;
}

export interface PhotoResult {
  photoId: string;
  /** "<page id>_<post id>", when Meta returns it. */
  postId: string | null;
}

/** Whether a time is inside Meta's scheduling window, measured from `now`. */
export function inScheduleWindow(at: Date, now: number = Date.now()): boolean {
  const ahead = at.getTime() - now;
  return Number.isFinite(ahead) && ahead >= SCHEDULE_MIN_MS && ahead <= SCHEDULE_MAX_MS;
}

const photoSchema = z.object({ id: z.string().min(1), post_id: z.string().min(1).optional() }).loose();

export async function postPagePhoto(call: MetaCall, page: { id: string; token: string }, post: PhotoPost, now: number = Date.now()): Promise<PhotoResult> {
  assertId(page.id, "Page");
  if (post.scheduleAt && !inScheduleWindow(post.scheduleAt, now)) throw new MetaError("schedule");
  const form = new FormData();
  form.set("source", new Blob([new Uint8Array(post.image.bytes)], { type: post.image.contentType }), post.image.filename);
  const params: Record<string, string> = { caption: post.caption, published: post.scheduleAt ? "false" : "true" };
  if (post.scheduleAt) params.scheduled_publish_time = String(Math.floor(post.scheduleAt.getTime() / 1000));
  const data = await graph(call, photoSchema, "POST", `${page.id}/photos`, params, page.token, form);
  return { photoId: data.id, postId: data.post_id ?? null };
}

// --- Instagram ----------------------------------------------------------------------------------------

export const NOT_PUBLIC_MESSAGE = "Instagram fetches the poster from a public https link, and this server's address is not public (for example localhost). Post to Instagram from the deployed site.";

/** An https URL on a public host, which Meta's servers can fetch. Never localhost or a private address. */
export function isPublicImageUrl(url: string): boolean {
  const checked = checkUrl(url);
  return checked.ok && checked.url.protocol === "https:" && checked.url.hostname.includes(".");
}

/** Hashtags in a caption, as Instagram counts them. */
export const hashtagCount = (caption: string) => (caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

export interface InstagramPost {
  /** A public https URL of a JPEG: Meta fetches it from its own servers. */
  imageUrl: string;
  /** Exactly the approved caption with its hashtags: never rewritten here. */
  caption: string;
  /** The poster's art came from an image model: Instagram's AI label is set. */
  aiGenerated: boolean;
}

export interface InstagramResult {
  mediaId: string;
  permalink: string | null;
  /** Set when Instagram did not take the AI label through the API, so the manager adds it in the app. */
  note: string | null;
}

export interface InstagramOptions {
  sleep?: (ms: number) => Promise<void>;
  statusChecks?: number;
}

const idSchema = z.object({ id: z.string().min(1) }).loose();
const statusSchema = z.object({ status_code: z.string().optional() }).loose();
const permalinkSchema = z.object({ permalink: z.url().optional() }).loose();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const AI_LABEL_NOTE = "Instagram did not take the AI label through the API. Turn on the AI label for this post in the Instagram app.";

/**
 * Publishes one image to an Instagram professional account: a media container from the public image
 * URL, a check that Meta has read the image, then media_publish. Instagram's API cannot schedule, so
 * this always publishes now. The Page token is used first, then the user token if Meta refuses it.
 */
export async function publishInstagramImage(call: MetaCall, account: { igUserId: string; tokens: readonly string[] }, post: InstagramPost, options: InstagramOptions = {}): Promise<InstagramResult> {
  assertId(account.igUserId, "Instagram account");
  if (!isPublicImageUrl(post.imageUrl)) throw new MetaError("image", NOT_PUBLIC_MESSAGE);
  if (post.caption.length > INSTAGRAM_CAPTION_MAX || hashtagCount(post.caption) > INSTAGRAM_HASHTAGS_MAX) {
    throw new MetaError("invalid", "This caption is longer than Instagram allows (2,200 characters and 30 hashtags). Stoop never cuts an approved caption.");
  }
  const sleep = options.sleep ?? wait;
  const tokens = account.tokens.filter(Boolean);
  if (tokens.length === 0) throw new MetaError("auth");
  let note: string | null = null;
  let token = tokens[0]!;
  const create = async (aiLabel: boolean) => graph(call, idSchema, "POST", `${account.igUserId}/media`, { image_url: post.imageUrl, caption: post.caption, ...(aiLabel ? { is_ai_generated: "true" } : {}) }, token);
  let container: { id: string };
  try {
    container = await create(post.aiGenerated);
  } catch (error) {
    if (!(error instanceof MetaError)) throw error;
    if ((error.kind === "auth" || error.kind === "permission") && tokens[1]) {
      token = tokens[1];
      container = await create(post.aiGenerated);
    } else if (post.aiGenerated && error.kind === "invalid" && error.code === 100 && error.subcode === null) {
      // An account that does not take the AI label through the API: publish, and tell the manager to add it.
      container = await create(false);
      note = AI_LABEL_NOTE;
    } else throw error;
  }
  const checks = Math.max(1, options.statusChecks ?? INSTAGRAM_STATUS_CHECKS);
  for (let i = 0; i < checks; i++) {
    const { status_code: status } = await graph(call, statusSchema, "GET", container.id, { fields: "status_code" }, token);
    if (status === "FINISHED" || status === "PUBLISHED" || status === undefined) break;
    if (status === "ERROR" || status === "EXPIRED") throw new MetaError("image", "Instagram could not read the poster image. Try again, or post to Facebook only.");
    if (i < checks - 1) await sleep(INSTAGRAM_STATUS_WAIT_MS);
  }
  const published = await graph(call, idSchema, "POST", `${account.igUserId}/media_publish`, { creation_id: container.id }, token);
  const permalink = await graph(call, permalinkSchema, "GET", published.id, { fields: "permalink" }, token)
    .then((data) => data.permalink ?? null)
    .catch(() => null);
  return { mediaId: published.id, permalink, note };
}
