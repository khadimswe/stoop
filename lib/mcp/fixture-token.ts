// Test-only: an MCP token stored the way POST /api/mcp/token stores one (only its hash and record), so
// the MCP tests call tools as a real token holder would. Imported from *.test.ts files only.
import { keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import { tokenLabel } from "./auth";
import { mcpTokenRecordSchema, newToken, tokenHash, type McpTokenRecord } from "./token";

export const FIXTURE_EMAIL_HASH = `h_${"e".repeat(32)}`;

export async function storeToken(store: Store, record: Partial<McpTokenRecord> = {}): Promise<{ token: string; hash: string; record: McpTokenRecord }> {
  const token = newToken();
  const hash = tokenHash(token);
  const full = mcpTokenRecordSchema.parse({
    email: FIXTURE_EMAIL_HASH,
    issuedAt: "2026-10-17T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    revokedAt: null,
    label: tokenLabel(hash),
    ...record,
  });
  await store.append(keys.mcp.tokens, [hash]);
  await store.set(keys.mcp.token(hash), full, { ttlSeconds: TTL.mcpToken });
  return { token, hash, record: full };
}
