import { describe, expect, it } from "vitest";
import { isTokenShaped, mcpTokenRecordSchema, newToken, redactToken, redactTokens, tokenActive, tokenHash, type McpTokenRecord } from "./token";

describe("mcp tokens", () => {
  it("are stp_ plus 43 base64url characters, never repeated", () => {
    const a = newToken();
    expect(isTokenShaped(a)).toBe(true);
    expect(a).not.toBe(newToken());
    expect(isTokenShaped("stp_short")).toBe(false);
  });

  it("are stored only as a hash, and logged only redacted", () => {
    const token = newToken();
    expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(token)).not.toContain(token.slice(4));
    expect(redactToken(token)).toBe(`${token.slice(0, 8)}...`);
    expect(redactTokens(`/api/mcp/${token}`)).toBe(`/api/mcp/${token.slice(0, 8)}...`);
    expect(redactTokens("/api/mcp")).toBe("/api/mcp");
  });

  it("stop working when revoked or expired", () => {
    const record: McpTokenRecord = {
      email: `h_${"0".repeat(32)}`,
      issuedAt: "2026-10-20T00:00:00.000Z",
      expiresAt: "2026-11-17T00:00:00.000Z",
      revokedAt: null,
      label: "stp_abcd",
    };
    expect(mcpTokenRecordSchema.parse(record)).toEqual(record);
    expect(tokenActive(record, Date.parse("2026-11-03T00:00:00Z"))).toBe(true);
    expect(tokenActive(record, Date.parse("2026-11-17T00:00:00Z"))).toBe(false);
    expect(tokenActive({ ...record, revokedAt: "2026-11-01T00:00:00.000Z" }, Date.parse("2026-11-03T00:00:00Z"))).toBe(false);
  });
});
