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
 * "t_" plus 24 hex: an MCP caller, by the first 24 hex of its token's hash (lib/mcp/token.ts tokenHash).
 * Authenticated MCP work counts per token instead of per IP, because hosted connectors (claude.ai) call
 * from servers that many users share.
 */
export type TokenVisitorId = string & { readonly [brand]: "TokenVisitorId" };

/** The visitor id of an MCP token, from its hash (never from the token itself). */
export function tokenVisitorId(tokenHash: string): TokenVisitorId {
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error("A token visitor comes from a token hash: 64 hex.");
  return `t_${tokenHash.slice(0, 24)}` as TokenVisitorId;
}

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

/** The 8 groups of an IPv6 address, or null when it is not one. Handles "::" and an IPv4 tail. */
function ipv6Groups(text: string): string[] | null {
  let address = text;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (tail) {
    const bytes = tail.slice(1).map(Number);
    if (bytes.some((b) => b > 255)) return null;
    address = `${address.slice(0, tail.index)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16).toString(16));
}

/**
 * What one visitor is, from their IP: an IPv4 address as it is, an IPv6 address by its /64 (one
 * household or device usually holds a whole /64, so per-address limits would be trivial to step
 * around). An IPv4-mapped IPv6 address counts as its IPv4 address. Anything unparseable stays as sent.
 */
export function ipGroup(ip: string): string {
  const bare = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (!bare.includes(":")) return bare;
  const groups = ipv6Groups(bare);
  if (!groups) return bare;
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const [hi, lo] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** Visitors without an IP (local dev, tests) share one id. An IPv6 visitor is their /64 (ipGroup). */
export async function visitorId(store: Store, headers: Headers): Promise<VisitorId> {
  const forwarded = clientIp(headers);
  const ip = forwarded ? ipGroup(forwarded) : "unknown";
  return `v_${sha256(`${await salt(store)}:ip:${ip}`).slice(0, 24)}` as VisitorId;
}
