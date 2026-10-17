// Visitors are known only by a salted hash of their IP, and emails by a salted hash in keys: per-visitor
// limits, one vote per visitor and one waitlist entry per email all work, and no raw IP is ever stored.
// The salt is 128 random bits, made once and kept in the store, so it never leaves the server and
// needs no env var; without it a hash of an IPv4 address could be reversed by trying them all.
import { sha256 } from "../hash";
import { keys } from "./keys";
import type { Store } from "./types";

declare const brand: unique symbol;
/** "h_" plus 32 hex: a salted hash, never the value itself. */
export type SaltedHash = string & { readonly [brand]: "SaltedHash" };
/** "v_" plus 24 hex: a visitor, by the salted hash of their IP. */
export type VisitorId = string & { readonly [brand]: "VisitorId" };
/** "c_" plus 24 hex: a visitor, by the random id in their signed visitor cookie (lib/visitor-cookie.ts). Clearing cookies makes a new one, so limits count it next to the IP id, never instead of it. */
export type CookieVisitorId = string & { readonly [brand]: "CookieVisitorId" };

/**
 * The client IP: the first x-forwarded-for entry, else x-real-ip. This trusts the host to set the
 * header, which Vercel does (it overwrites what the client sent). A host that passes the client's own
 * header through needs its own reader, or anyone could pose as many visitors.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || null;
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One read per process: the salt never changes once made. */
const salts = new WeakMap<Store, Promise<string>>();

async function readSalt(store: Store): Promise<string> {
  const existing = await store.get<string>(keys.visitorSalt);
  if (existing) return existing;
  await store.set(keys.visitorSalt, randomSalt(), { ifAbsent: true });
  // Two first visitors may race: whichever salt landed is the one everyone uses.
  const landed = await store.get<string>(keys.visitorSalt);
  if (!landed) throw new Error("The visitor salt could not be stored.");
  return landed;
}

function salt(store: Store): Promise<string> {
  let cached = salts.get(store);
  if (!cached) {
    cached = readSalt(store);
    salts.set(store, cached);
    // A failed read is retried on the next call instead of being cached.
    cached.catch(() => salts.delete(store));
  }
  return cached;
}

/** A salted hash of any value (an email, normalized by the caller), for use in keys. */
export async function saltedHash(store: Store, value: string): Promise<SaltedHash> {
  return `h_${sha256(`${await salt(store)}:${value}`).slice(0, 32)}` as SaltedHash;
}

/** Visitors without an IP (local dev, tests) share one id. */
export async function visitorId(store: Store, headers: Headers): Promise<VisitorId> {
  const ip = clientIp(headers) ?? "unknown";
  return `v_${sha256(`${await salt(store)}:ip:${ip}`).slice(0, 24)}` as VisitorId;
}
