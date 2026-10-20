// The founder's token tools (scripts/mcp-token.ts): list issued MCP tokens, and revoke them by label,
// by reference or by email. Only hashes and records are stored, so nothing here can show a full token.
// A listing shows the label ("stp_" plus 4 hex of the hash), a reference (the first 12 hex of the hash,
// which tells tokens with the same label apart and is no use for calling Stoop), the dates and the
// status; never the email hash.
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import { saltedHash } from "../store/visitor";
import { normalizeEmail } from "../waitlist";
import { mcpTokenRecordSchema, tokenActive, tokenRecordTtl, type McpTokenRecord } from "./token";

export interface TokenListing {
  label: string;
  /** The first 12 hex of the token's hash. */
  ref: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
}

interface StoredToken {
  hash: string;
  record: McpTokenRecord;
}

export const REF_LENGTH = 12;

/** Every issued token that still has a record, oldest first. A record that no longer parses is skipped. */
async function storedTokens(store: Store): Promise<StoredToken[]> {
  const hashes = [...new Set(await store.range<string>(keys.mcp.tokens, 0, -1))];
  const found: StoredToken[] = [];
  for (let i = 0; i < hashes.length; i += 50) {
    const batch = hashes.slice(i, i + 50);
    const raws = await Promise.all(batch.map((hash) => store.get<unknown>(keys.mcp.token(hash))));
    raws.forEach((raw, j) => {
      const parsed = mcpTokenRecordSchema.safeParse(raw);
      if (parsed.success) found.push({ hash: batch[j], record: parsed.data });
    });
  }
  return found.sort((a, b) => a.record.issuedAt.localeCompare(b.record.issuedAt));
}

const statusOf = (record: McpTokenRecord, now: number): TokenListing["status"] => (record.revokedAt !== null ? "revoked" : tokenActive(record, now) ? "active" : "expired");

const listing = ({ hash, record }: StoredToken, now: number): TokenListing => ({
  label: record.label,
  ref: hash.slice(0, REF_LENGTH),
  issuedAt: record.issuedAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  status: statusOf(record, now),
});

export async function listTokens(store: Store, now: number = Date.now()): Promise<TokenListing[]> {
  return (await storedTokens(store)).map((t) => listing(t, now));
}

async function revoke(store: Store, tokens: readonly StoredToken[], now: number): Promise<TokenListing[]> {
  const at = new Date(now).toISOString();
  const revoked: TokenListing[] = [];
  for (const { hash, record } of tokens) {
    if (record.revokedAt !== null) continue;
    const next = { ...record, revokedAt: at };
    // A set without a TTL would clear the record's expiry, so it is given one again.
    await store.set(keys.mcp.token(hash), mcpTokenRecordSchema.parse(next), { ttlSeconds: tokenRecordTtl(Date.parse(record.expiresAt), now) });
    revoked.push(listing({ hash, record: next }, now));
  }
  return revoked;
}

/** The shortest prefix accepted: "stp_" plus 2 for a label, 8 hex for a reference, so a typo can never revoke every token. */
export const MIN_LABEL_PREFIX = 6;
export const MIN_REF_PREFIX = 8;

export type RevokeOne = { outcome: "revoked"; revoked: TokenListing[] } | { outcome: "none" } | { outcome: "ambiguous"; matches: TokenListing[] } | { outcome: "too-short" };

/**
 * Revokes the one token a label prefix ("stp_...") or a reference prefix (hex) names. Labels are short,
 * so two tokens can share one: anything that matches more than one token revokes nothing and lists
 * them, so a reference can pick one.
 */
export async function revokeOne(store: Store, prefix: string, now: number = Date.now()): Promise<RevokeOne> {
  const byLabel = prefix.startsWith("stp_");
  if (byLabel ? prefix.length < MIN_LABEL_PREFIX : !/^[0-9a-f]+$/.test(prefix) || prefix.length < MIN_REF_PREFIX) return { outcome: "too-short" };
  const matches = (await storedTokens(store)).filter((t) => (byLabel ? t.record.label.startsWith(prefix) : t.hash.startsWith(prefix)));
  if (matches.length === 0) return { outcome: "none" };
  if (matches.length > 1) return { outcome: "ambiguous", matches: matches.map((t) => listing(t, now)) };
  return { outcome: "revoked", revoked: await revoke(store, matches, now) };
}

/** Revokes every token issued to this email (found by its salted hash, as the issuing route stored it). */
export async function revokeByEmail(store: Store, email: string, now: number = Date.now()): Promise<TokenListing[]> {
  const hash = await saltedHash(store, normalizeEmail(email));
  return revoke(store, (await storedTokens(store)).filter((t) => t.record.email === hash), now);
}
