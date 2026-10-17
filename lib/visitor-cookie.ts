// The signed visitor cookie: a random id the server can trust it issued, so per-visitor limits (storyboards)
// count a browser next to its IP. It identifies nothing about the person and is never stored raw anywhere
// but the browser. Without STOOP_SIGNING_SECRET there is no cookie id, and limits fall back to the IP alone.
import { randomHex, sign, verifySignature } from "./sign";
import type { CookieVisitorId } from "./store/visitor";

export const VISITOR_COOKIE = "stoop_visitor";
export const VISITOR_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

const ID = /^c_[0-9a-f]{24}$/;

/** A new cookie value, "c_<24 hex>.<mac>", and the id it carries. */
export function mintVisitorCookie(secret: string, id: string = `c_${randomHex(12)}`): { id: CookieVisitorId; value: string } {
  if (!ID.test(id)) throw new Error("A visitor id is c_ plus 24 hex.");
  return { id: id as CookieVisitorId, value: `${id}.${sign(secret, "visitor", id)}` };
}

/** The id in a cookie value this server signed, or null for anything else. */
export function readVisitorCookie(secret: string | null, value: string | null | undefined): CookieVisitorId | null {
  if (!secret || !value) return null;
  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const id = value.slice(0, dot);
  if (!ID.test(id)) return null;
  return verifySignature(secret, "visitor", id, value.slice(dot + 1)) ? (id as CookieVisitorId) : null;
}
