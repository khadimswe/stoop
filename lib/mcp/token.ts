// MCP tokens for /api/mcp: "stp_" plus 32 random bytes in base64url (the prefix lets secret scanners
// recognize a leaked one). The token is shown once and emailed at most once; only its SHA-256 is
// stored, with a record that expires when judging ends (lib/config.ts judgingEndsAt) and is kept a
// little past that. Its caps are counted under keys.mcp.
//
// No character of a token is ever logged or stored: a log line names a token by its label, which
// comes from the hash ("stp_" plus 4 hex of it), as the revoke script lists it. Prefer sending it as
// "Authorization: Bearer"; the path form (/api/mcp/<token>) exists for clients that only take a URL.
// Stoop's own logs redact it there too, but the hosting platform's request logs record paths, which is
// why every token is capped, expiring and revocable (scripts/mcp-token.ts).
import { z } from "zod";
import { judgingEndsAt } from "../config";
import { sha256 } from "../hash";
import { DAY_SECONDS, TTL } from "../store/keys";

export const TOKEN_PREFIX = "stp_";
export const TOKEN_PATTERN = /^stp_[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${TOKEN_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

export const isTokenShaped = (value: string) => TOKEN_PATTERN.test(value);

/** The store key part for a token: never the token itself. */
export const tokenHash = (token: string) => sha256(`mcp-token:${token}`);

/**
 * A token's label for the founder's listing, the AuthInfo clientId and log lines: "stp_" plus the
 * first 4 hex of its hash, so not one character of the token itself is kept, passed along or logged.
 */
export const tokenLabel = (hash: string) => `stp_${hash.slice(0, 4)}`;

/** For logs: a token named by its label (from its hash). Anything else token-like is "[token]". */
export const redactToken = (token: string) => (isTokenShaped(token) ? `[token ${tokenLabel(tokenHash(token))}]` : "[token]");

/** Any token-like text in a path or message, replaced whole by redactToken: no character of it is kept. */
export const redactTokens = (text: string) => text.replace(/stp_[A-Za-z0-9_-]{8,}/g, redactToken);

export const mcpTokenRecordSchema = z.strictObject({
  /** The salted hash of the email it was issued to (keys.waitlist.entry), so it can be found and revoked by email. */
  email: z.string().regex(/^h_[0-9a-f]{32}$/),
  issuedAt: z.iso.datetime(),
  /** When judging ended as of issuing (JUDGING_ENDS_AT then). tokenActive also checks the current end date. */
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  /** tokenLabel(hash): from the hash, never from the token, for the revoke script's listing. */
  label: z.string().regex(/^stp_[A-Za-z0-9_-]{4}$/),
});
export type McpTokenRecord = z.infer<typeof mcpTokenRecordSchema>;

/**
 * Whether a stored record still admits calls at `now`: not revoked, and before the earlier of its
 * stored expiry and the current end of judging (JUDGING_ENDS_AT as it is now), so moving the end date
 * earlier ends every token with it.
 */
export function tokenActive(record: McpTokenRecord, now: number = Date.now(), endsAt: number = judgingEndsAt()): boolean {
  return record.revokedAt === null && now < Math.min(Date.parse(record.expiresAt), endsAt);
}

/** How long a record outlives its expiry, so a late call is refused as expired rather than unknown. */
export const TOKEN_RECORD_GRACE_SECONDS = 14 * DAY_SECONDS;

/**
 * A token record's TTL (and the token list's), in seconds: until its expiry plus the grace, never less
 * than TTL.mcpToken. Issued with expiresAt at JUDGING_ENDS_AT, so the record lasts at least until
 * judging ends, however far off that is.
 */
export function tokenRecordTtl(expiresAt: number, now: number): number {
  return Math.max(TTL.mcpToken, Math.ceil(Math.max(0, expiresAt - now) / 1000) + TOKEN_RECORD_GRACE_SECONDS);
}
