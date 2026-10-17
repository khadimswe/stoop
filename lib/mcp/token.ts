// MCP tokens for /api/mcp: "stp_" plus 32 random bytes in base64url (the prefix lets secret scanners
// recognize a leaked one). The token is shown once, emailed once, and only its SHA-256 is stored, with
// an expiry when judging ends (lib/config.ts judgingEndsAt); its caps are counted under keys.mcp.
// Prefer sending it as "Authorization: Bearer"; the path form (/api/mcp/<token>) exists for clients
// that only take a URL, and hosting logs record paths, which is why every token is capped, expiring and
// revocable (scripts/mcp-token.ts).
import { z } from "zod";
import { sha256 } from "../hash";

export const TOKEN_PREFIX = "stp_";
export const TOKEN_PATTERN = /^stp_[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${TOKEN_PREFIX}${Buffer.from(bytes).toString("base64url")}`;
}

export const isTokenShaped = (value: string) => TOKEN_PATTERN.test(value);

/** The store key part for a token: never the token itself. */
export const tokenHash = (token: string) => sha256(`mcp-token:${token}`);

/** For logs and the revoke script: enough to tell tokens apart, never enough to use one. */
export const redactToken = (token: string) => (isTokenShaped(token) ? `${token.slice(0, 8)}...` : "[token]");

/** Any token-shaped text in a path or message, redacted. */
export const redactTokens = (text: string) => text.replace(/stp_[A-Za-z0-9_-]{8,}/g, (t) => `${t.slice(0, 8)}...`);

export const mcpTokenRecordSchema = z.strictObject({
  /** The salted hash of the email it was issued to (keys.waitlist.entry), so it can be found and revoked by email. */
  email: z.string().regex(/^h_[0-9a-f]{32}$/),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  /** The first 8 characters, for the revoke script's listing. */
  label: z.string().regex(/^stp_[A-Za-z0-9_-]{4}$/),
});
export type McpTokenRecord = z.infer<typeof mcpTokenRecordSchema>;

/** Whether a stored record still admits calls at `now`. */
export const tokenActive = (record: McpTokenRecord, now: number = Date.now()) => record.revokedAt === null && now < Date.parse(record.expiresAt);
