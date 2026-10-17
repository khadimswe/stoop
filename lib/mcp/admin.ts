// The founder's token tools (scripts/mcp-token.ts): list issued MCP tokens, and revoke them by label
// or by email. Only hashes and records are stored, so nothing here can show a full token; listings show
// the 8-character label, the dates and the status, never the hash or the email hash.
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { saltedHash } from "../store/visitor";
import { normalizeEmail } from "../waitlist";
import { mcpTokenRecordSchema, tokenActive, type McpTokenRecord } from "./token";

export interface TokenListing {
  label: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
}

interface StoredToken {
  hash: string;
  record: McpTokenRecord;
}

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

const listing = (record: McpTokenRecord, now: number): TokenListing => ({
  label: record.label,
  issuedAt: record.issuedAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  status: statusOf(record, now),
});

export async function listTokens(store: Store, now: number = Date.now()): Promise<TokenListing[]> {
  return (await storedTokens(store)).map((t) => listing(t.record, now));
}

async function revoke(store: Store, tokens: readonly StoredToken[], now: number): Promise<TokenListing[]> {
  const at = new Date(now).toISOString();
  const revoked: TokenListing[] = [];
  for (const { hash, record } of tokens) {
    if (record.revokedAt !== null) continue;
    const next = { ...record, revokedAt: at };
    // A set without a TTL would clear the record's expiry, so it is given one again.
    await store.set(keys.mcp.token(hash), mcpTokenRecordSchema.parse(next), { ttlSeconds: TTL.mcpToken });
    revoked.push(listing(next, now));
  }
  return revoked;
}

/** The shortest label prefix accepted: "stp_" plus 2 characters, so a typo can never revoke every token. */
export const MIN_LABEL_PREFIX = 6;

export type RevokeByLabel = { outcome: "revoked"; revoked: TokenListing[] } | { outcome: "none" } | { outcome: "ambiguous"; matches: TokenListing[] } | { outcome: "too-short" };

/**
 * Revokes the token whose label starts with `prefix`. A prefix that matches tokens with different
 * labels is ambiguous and revokes nothing; tokens sharing one full label are all revoked.
 */
export async function revokeByLabel(store: Store, prefix: string, now: number = Date.now()): Promise<RevokeByLabel> {
  if (prefix.length < MIN_LABEL_PREFIX || !prefix.startsWith("stp_")) return { outcome: "too-short" };
  const matches = (await storedTokens(store)).filter((t) => t.record.label.startsWith(prefix));
  if (matches.length === 0) return { outcome: "none" };
  if (new Set(matches.map((t) => t.record.label)).size > 1) return { outcome: "ambiguous", matches: matches.map((t) => listing(t.record, now)) };
  return { outcome: "revoked", revoked: await revoke(store, matches, now) };
}

/** Revokes every token issued to this email (found by its salted hash, as the issuing route stored it). */
export async function revokeByEmail(store: Store, email: string, now: number = Date.now()): Promise<TokenListing[]> {
  const hash = await saltedHash(store, normalizeEmail(email));
  return revoke(store, (await storedTokens(store)).filter((t) => t.record.email === hash), now);
}
