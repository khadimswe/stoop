// The waitlist: "Get a free brief". An entry is keyed by the salted hash of the normalized email, so a
// repeat signup (the success screen's product link, a later "Reserve") keeps its position. Positions
// come from one counter, so they are real: nothing pre-fills or skips ahead. The entry keeps the email
// itself (the founder writes back to it) but never an IP.
//
// Anyone can type anyone's email, so a repeat only rewrites an entry when it carries the signup token
// the first signup's browser got (a first-party cookie, kept as a salted hash). Without it, a repeat
// can only fill fields the entry left empty, and never changes consent.
import { z } from "zod";
import { PLANS, type WaitlistRequest } from "./api/requests";
import { SELLS_ON } from "./sells-on";
import { keys } from "./store/keys";
import type { Store } from "./store/types";
import { saltedHash, type SaltedHash } from "./store/visitor";

const sellsOnValues = SELLS_ON.map((option) => option.value) as [(typeof SELLS_ON)[number]["value"], ...(typeof SELLS_ON)[number]["value"][]];

export const waitlistEntrySchema = z.strictObject({
  position: z.number().int().positive(),
  email: z.string().min(3).max(254),
  sellsOn: z.enum(sellsOnValues).nullable(),
  consent: z.boolean(),
  plan: z.enum(PLANS).nullable(),
  sourceReport: z.string().nullable(),
  productLink: z.string().nullable(),
  /** Salted hash of the signup token of the browser that created the entry. */
  editKey: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

/** The first-party cookie that lets a browser update the entries it created. Random, never derived from the email. */
export const SIGNUP_COOKIE = "stoop_signup";
export const SIGNUP_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const SIGNUP_TOKEN = /^[0-9a-f]{32}$/;

export function newSignupToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A cookie value Stoop could have set, or null. */
export function validSignupToken(value: string | null): string | null {
  return value && SIGNUP_TOKEN.test(value) ? value : null;
}

/** Trimmed and lowercased, so "Ana@Shop.com " and "ana@shop.com" are one signup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface JoinResult {
  entry: WaitlistEntry;
  /** True for a first signup (the one that gets the confirmation email). */
  created: boolean;
}

type Signup = Omit<WaitlistRequest, "company">;

/**
 * A repeat signup keeps its position and creation date. With the entry's own token, the fields it
 * sends replace the stored ones; without it, they only fill what is still empty.
 */
function merge(existing: WaitlistEntry, signup: Signup, owner: boolean, now: string): WaitlistEntry {
  const pick = <T>(sent: T | null | undefined, stored: T | null): T | null => (owner ? (sent ?? stored) : (stored ?? sent ?? null));
  const next: WaitlistEntry = {
    ...existing,
    sellsOn: pick(signup.sellsOn, existing.sellsOn),
    consent: owner ? signup.consent : existing.consent,
    plan: pick(signup.plan, existing.plan),
    sourceReport: pick(signup.sourceReport, existing.sourceReport),
    productLink: pick(signup.productLink, existing.productLink),
  };
  const changed = (Object.keys(next) as (keyof WaitlistEntry)[]).some((field) => next[field] !== existing[field]);
  return changed ? { ...next, updatedAt: now } : existing;
}

/**
 * Adds a signup, or updates the entry this email already has. `token` is the browser's signup token
 * (from its cookie, or freshly made for it). The caller has dropped honeypot hits.
 */
export async function joinWaitlist(store: Store, signup: Signup, options: { token: string; now?: Date }): Promise<JoinResult> {
  const now = (options.now ?? new Date()).toISOString();
  const email = normalizeEmail(signup.email);
  const hash = await saltedHash(store, email);
  const key = keys.waitlist.entry(hash);
  const editKey = await saltedHash(store, `signup:${options.token}`);

  const existing = await readEntry(store, key);
  if (existing) return update(store, key, existing, signup, existing.editKey === editKey, now);

  const position = await store.incr(keys.waitlist.position);
  const entry: WaitlistEntry = {
    position,
    email,
    sellsOn: signup.sellsOn,
    consent: signup.consent,
    plan: signup.plan ?? null,
    sourceReport: signup.sourceReport ?? null,
    productLink: signup.productLink ?? null,
    editKey,
    createdAt: now,
    updatedAt: now,
  };
  // Listed before it is written, so a failed write can never leave an entry the export cannot find
  // (a retry lists it again; listEntries drops repeats and hashes with no entry).
  await store.append(keys.waitlist.entries, [hash]);
  if (await store.set(key, entry, { ifAbsent: true })) return { entry, created: true };
  // The same email signed up twice at once: the other request won, so this one updates its entry.
  // The position taken above stays unused, a gap in the numbering rather than a duplicate.
  const winner = await readEntry(store, key);
  if (!winner) throw new Error("A waitlist entry vanished while it was being written.");
  return update(store, key, winner, signup, winner.editKey === editKey, now);
}

async function update(store: Store, key: string, existing: WaitlistEntry, signup: Signup, owner: boolean, now: string): Promise<JoinResult> {
  const entry = merge(existing, signup, owner, now);
  if (entry !== existing) await store.set(key, entry);
  return { entry, created: false };
}

async function readEntry(store: Store, key: string): Promise<WaitlistEntry | null> {
  const raw = await store.get<unknown>(key);
  return raw === null ? null : waitlistEntrySchema.parse(raw);
}

/** What a honeypot hit is told: the next position, as a real signup would see it. Nothing is written. */
export async function nextPosition(store: Store): Promise<number> {
  return ((await store.get<number>(keys.waitlist.position)) ?? 0) + 1;
}

/** Every entry in signup order, for the founder's export. An entry that no longer parses is skipped (and logged), never fatal. */
export async function listEntries(store: Store, options: { batch?: number } = {}): Promise<WaitlistEntry[]> {
  const hashes = [...new Set(await store.range<SaltedHash>(keys.waitlist.entries, 0, -1))];
  const batch = options.batch ?? 50;
  const entries: WaitlistEntry[] = [];
  let skipped = 0;
  for (let i = 0; i < hashes.length; i += batch) {
    const raws = await Promise.all(hashes.slice(i, i + batch).map((hash) => store.get<unknown>(keys.waitlist.entry(hash))));
    for (const raw of raws) {
      if (raw === null) continue;
      const parsed = waitlistEntrySchema.safeParse(raw);
      if (parsed.success) entries.push(parsed.data);
      else skipped++;
    }
  }
  if (skipped) console.warn(`Waitlist export skipped ${skipped} ${skipped === 1 ? "entry" : "entries"} that no longer match the entry schema.`);
  return entries.sort((a, b) => a.position - b.position);
}
