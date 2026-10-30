// One browser's Meta connection, kept on the server only:
// - the OAuth `state`: a signed value with a random nonce, an expiry and the page to return to; the
//   same nonce sits in a short httpOnly cookie, so a login another site started is refused;
// - the session cookie: a random id plus its HMAC ("m_<24 hex>.<mac>"), httpOnly, SameSite=Lax,
//   scoped to /api, living as long as the connection (connectionTtlSeconds);
// - the tokens: the long-lived user token and the Page tokens, sealed with AES-256-GCM under a key
//   derived from STOOP_SIGNING_SECRET (lib/sign.ts subkey "meta-token"), bound to the session id, and
//   stored in Upstash with a TTL that ends at META_POSTING_ENDS_AT (when set) and within 60 days. The
//   browser never sees a token.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { readCookie } from "../http";
import { randomHex, safeEqual, sign, subkey, verifySignature } from "../sign";
import { keys } from "../store/keys";
import type { Store } from "../store/types";

if (typeof window !== "undefined") {
  throw new Error("lib/social/session runs on the server only.");
}

export const META_SESSION_COOKIE = "stoop_meta";
export const META_STATE_COOKIE = "stoop_meta_state";
/** The session cookie is sent only to the API routes that need it. */
export const META_SESSION_PATH = "/api";
export const META_STATE_PATH = "/api/social/meta";
/** A login has this long to come back from Facebook. */
export const STATE_TTL_SECONDS = 10 * 60;

// --- Where to return ----------------------------------------------------------------------------

/** A path on this site to send the manager back to; anything else ("//evil.example", a full URL) is "/". */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  // No spaces or control characters: a header value is built from it.
  if ([...raw].some((c) => c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f)) return "/";
  try {
    const url = new URL(raw, "https://stoop.invalid");
    const path = `${url.pathname}${url.search}`;
    // Checked again after the parser resolves "/.//x" or "/%2e%2e//x" to "//x", which a browser reads as another host.
    return url.origin === "https://stoop.invalid" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/";
  } catch {
    return "/";
  }
}

// --- The OAuth state ----------------------------------------------------------------------------

const STATE = /^v1\.([0-9a-f]{32})\.(\d{1,12})\.([A-Za-z0-9_-]{0,420})\.([A-Za-z0-9_-]{43})$/;

/** A new state for the dialog, and the nonce for the state cookie. */
export function mintState(secret: string, returnTo: string, now: number = Date.now(), nonce: string = randomHex(16)): { state: string; nonce: string } {
  const exp = Math.floor(now / 1000) + STATE_TTL_SECONDS;
  const body = `v1.${nonce}.${exp}.${Buffer.from(safeReturnPath(returnTo)).toString("base64url")}`;
  return { state: `${body}.${sign(secret, "meta-state", body)}`, nonce };
}

/** The return path in a state this server signed, unexpired and matching the browser's state cookie; else null. */
export function verifyState(secret: string, state: string | null, cookieNonce: string | null, now: number = Date.now()): { returnTo: string } | null {
  if (!state || !cookieNonce) return null;
  const match = STATE.exec(state);
  if (!match) return null;
  const [, nonce, exp, returnTo, mac] = match as unknown as [string, string, string, string, string];
  const body = `v1.${nonce}.${exp}.${returnTo}`;
  if (!verifySignature(secret, "meta-state", body, mac)) return null;
  if (!safeEqual(nonce, cookieNonce)) return null;
  if (Number(exp) < Math.floor(now / 1000)) return null;
  return { returnTo: safeReturnPath(Buffer.from(returnTo, "base64url").toString("utf8")) };
}

// --- Cookies --------------------------------------------------------------------------------------

const SESSION_ID = /^m_[0-9a-f]{24}$/;

/** A new session id and its cookie value. */
export function mintSession(secret: string, id: string = `m_${randomHex(12)}`): { id: string; value: string } {
  if (!SESSION_ID.test(id)) throw new Error("A Meta session id is m_ plus 24 hex.");
  return { id, value: `${id}.${sign(secret, "meta-session", id)}` };
}

/** The session id in a cookie value this server signed, or null. */
export function readSession(secret: string | null, value: string | null | undefined): string | null {
  if (!secret || !value) return null;
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const id = value.slice(0, dot);
  return SESSION_ID.test(id) && verifySignature(secret, "meta-session", id, value.slice(dot + 1)) ? id : null;
}

export const sessionOf = (request: Request, secret: string | null) => readSession(secret, readCookie(request, META_SESSION_COOKIE));

/** A Set-Cookie value: HttpOnly, SameSite=Lax, Secure on https. Max-Age 0 clears it. */
export function cookie(request: Request, name: string, value: string, maxAgeSeconds: number, path: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; HttpOnly; SameSite=Lax${secure}`;
}

// --- The stored connection ----------------------------------------------------------------------------

export const metaConnectionSchema = z.strictObject({
  v: z.literal(1),
  user: z.strictObject({ token: z.string().min(1), expiresAt: z.number().nullable() }),
  pages: z
    .array(
      z.strictObject({
        id: z.string().regex(/^\d{1,30}$/),
        name: z.string().min(1),
        token: z.string().min(1),
        canPost: z.boolean(),
        instagram: z.strictObject({ id: z.string().regex(/^\d{1,30}$/), username: z.string().nullable() }).nullable(),
      }),
    )
    .max(100),
  connectedAt: z.iso.datetime(),
});
export type MetaConnection = z.infer<typeof metaConnectionSchema>;

const sealedSchema = z.strictObject({ v: z.literal(1), iv: z.string().min(1), tag: z.string().min(1), data: z.string().min(1) });
type Sealed = z.infer<typeof sealedSchema>;

/** AES-256-GCM, with the session id as associated data: a record copied to another id does not open. */
export function seal(secret: string, sessionId: string, value: unknown): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(secret, "meta-token"), iv);
  cipher.setAAD(Buffer.from(sessionId, "utf8"));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
}

/** The value inside a sealed record, or null when it does not open (another key, another id, tampered). */
export function unseal(secret: string, sessionId: string, sealed: unknown): unknown {
  const parsed = sealedSchema.safeParse(sealed);
  if (!parsed.success) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", subkey(secret, "meta-token"), Buffer.from(parsed.data.iv, "base64url"));
    decipher.setAAD(Buffer.from(sessionId, "utf8"));
    decipher.setAuthTag(Buffer.from(parsed.data.tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(parsed.data.data, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A connection never outlives its long-lived Meta user token (about 60 days). */
export const CONNECTION_MAX_SECONDS = 60 * 24 * 60 * 60;

/**
 * Seconds a connection may live: until posting ends (META_POSTING_ENDS_AT, lib/config.ts; with no end
 * set, `until` is Infinity) and never past CONNECTION_MAX_SECONDS. Zero once posting has ended (nothing is stored).
 */
export function connectionTtlSeconds(until: number, now: number = Date.now()): number {
  return Math.max(0, Math.min(CONNECTION_MAX_SECONDS, Math.floor((until - now) / 1000)));
}

export async function saveConnection(store: Store, secret: string, sessionId: string, connection: MetaConnection, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) throw new Error("Meta posting has ended (META_POSTING_ENDS_AT).");
  await store.set(keys.social.metaSession(sessionId), seal(secret, sessionId, metaConnectionSchema.parse(connection)), { ttlSeconds });
}

export async function loadConnection(store: Store, secret: string, sessionId: string): Promise<MetaConnection | null> {
  const sealed = await store.get<unknown>(keys.social.metaSession(sessionId));
  if (sealed === null) return null;
  const parsed = metaConnectionSchema.safeParse(unseal(secret, sessionId, sealed));
  return parsed.success ? parsed.data : null;
}

export async function deleteConnection(store: Store, sessionId: string): Promise<void> {
  await store.del(keys.social.metaSession(sessionId));
}
