// Small helpers shared by lane C's route handlers: JSON answers in the API's shapes, a size-capped
// body reader, and cookie parsing. Plain Web Request and Response, so handlers test without Next.
import { apiErrorSchema, type ApiError } from "./api/responses";
import type { CookieVisitorId } from "./store/visitor";
import { mintVisitorCookie, readVisitorCookie, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "./visitor-cookie";

type ErrorCode = ApiError["error"]["code"];

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(NO_STORE)) if (!headers.has(name)) headers.set(name, value);
  return Response.json(body, { status: init.status ?? 200, headers });
}

/** An error in the shape every route answers with (apiErrorSchema). */
export function apiError(code: ErrorCode, message: string, status: number, headers?: HeadersInit): Response {
  return json(apiErrorSchema.parse({ error: { code, message } }), { status, headers });
}

export const MESSAGES = {
  invalidJson: "Send a JSON body.",
  notJson: "Send JSON with Content-Type: application/json.",
  crossSite: "Requests from other sites are not accepted.",
  tooLarge: "That request is too large.",
  rateLimited: "Too many requests from here. Try again in a little while.",
  bot: "This request looks automated.",
  failed: "That didn't go through. Try again in a moment.",
  storeDown: "Saving is paused right now. Try again soon.",
} as const;

export function rateLimited(retryAfterSeconds: number): Response {
  return apiError("rate_limited", MESSAGES.rateLimited, 429, { "Retry-After": String(retryAfterSeconds) });
}

export class BodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads a JSON body of at most `maxBytes`, or throws BodyError (415 when it is not sent as JSON, 400
 * for bad JSON, 413 for too large). Requiring the JSON content type matters: another site's plain form
 * can post text/plain without asking, but never application/json.
 */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) throw new BodyError(415, MESSAGES.notJson);
  const text = new TextDecoder().decode(await readBody(request, maxBytes));
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, MESSAGES.invalidJson);
  }
}

/** The body's bytes, stopping as soon as they pass the cap (a missing or false content-length cannot get around it). */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(413, MESSAGES.tooLarge);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyError(413, MESSAGES.tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** One cookie's value from the Cookie header, or null. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** A first-party cookie: HttpOnly, SameSite=Lax, Secure on https. */
export function cookieHeader(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`;
}

/** The id in the request's signed visitor cookie, or null (no secret, no cookie, or one this server did not sign). */
export function cookieVisitorOf(request: Request, secret: string | null): CookieVisitorId | null {
  return readVisitorCookie(secret, readCookie(request, VISITOR_COOKIE));
}

/**
 * The browser's visitor cookie id, minting one when there is a signing secret and the browser has no
 * valid cookie: `setCookie` is then the header to send back (HttpOnly, SameSite=Lax, Secure on https).
 * Without a secret there is no cookie id at all, and limits count the IP alone.
 */
export function visitorCookie(request: Request, secret: string | null): { id: CookieVisitorId | null; setCookie: string | null } {
  const existing = cookieVisitorOf(request, secret);
  if (existing || !secret) return { id: existing, setCookie: null };
  const minted = mintVisitorCookie(secret);
  return { id: minted.id, setCookie: cookieHeader(request, VISITOR_COOKIE, minted.value, VISITOR_COOKIE_MAX_AGE) };
}
