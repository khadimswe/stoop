import { describe, expect, it } from "vitest";
import { DAY_SECONDS, TTL } from "../store/keys";
import {
  isTokenShaped,
  mcpTokenRecordSchema,
  newToken,
  redactToken,
  redactTokens,
  TOKEN_RECORD_GRACE_SECONDS,
  tokenActive,
  tokenHash,
  tokenLabel,
  tokenRecordTtl,
  type McpTokenRecord,
} from "./token";

describe("mcp tokens", () => {
  it("are stp_ plus 43 base64url characters, never repeated", () => {
    const a = newToken();
    expect(isTokenShaped(a)).toBe(true);
    expect(a).not.toBe(newToken());
    expect(isTokenShaped("stp_short")).toBe(false);
  });

  it("are stored only as a hash, and logged only by their label, which comes from the hash", () => {
    const token = newToken();
    const hash = tokenHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
    expect(tokenLabel(hash)).toBe(`stp_${hash.slice(0, 4)}`);
    expect(redactToken(token)).toBe(`[token ${tokenLabel(hash)}]`);
    expect(redactToken("stp_not-a-whole-token")).toBe("[token]");
    expect(redactTokens(`/api/mcp/${token}`)).toBe(`/api/mcp/[token ${tokenLabel(hash)}]`);
    expect(redactTokens(`could not serve Bearer ${token} for stp_${token.slice(4, 14)}`)).toBe(`could not serve Bearer [token ${tokenLabel(hash)}] for [token]`);
    expect(redactTokens("/api/mcp")).toBe("/api/mcp");
  });

  it("log no character of the token, not even its first ones after the prefix", () => {
    for (let i = 0; i < 20; i++) {
      const token = newToken();
      // The whole token is replaced: what remains is the path and the label (4 hex of the hash).
      expect(redactTokens(`/api/mcp/${token}`)).toBe(`/api/mcp/[token stp_${tokenHash(token).slice(0, 4)}]`);
    }
  });

  const record: McpTokenRecord = {
    email: `h_${"0".repeat(32)}`,
    issuedAt: "2026-10-20T00:00:00.000Z",
    expiresAt: "2026-11-17T00:00:00.000Z",
    revokedAt: null,
    label: "stp_abcd",
  };
  const FAR = Date.parse("2099-01-01T00:00:00Z");

  it("stop working when revoked or expired", () => {
    expect(mcpTokenRecordSchema.parse(record)).toEqual(record);
    expect(tokenActive(record, Date.parse("2026-11-03T00:00:00Z"), FAR)).toBe(true);
    expect(tokenActive(record, Date.parse("2026-11-17T00:00:00Z"), FAR)).toBe(false);
    expect(tokenActive({ ...record, revokedAt: "2026-11-01T00:00:00.000Z" }, Date.parse("2026-11-03T00:00:00Z"), FAR)).toBe(false);
  });

  it("end at the earlier of their stored expiry and the current end of judging", () => {
    const now = Date.parse("2026-11-03T00:00:00Z");
    // JUDGING_ENDS_AT moved earlier after issuing: the token ends with it.
    expect(tokenActive(record, now, Date.parse("2026-11-02T00:00:00Z"))).toBe(false);
    expect(tokenActive(record, now, Date.parse("2026-11-04T00:00:00Z"))).toBe(true);
    // Moved later: the stored expiry still holds.
    expect(tokenActive(record, Date.parse("2026-11-20T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z"))).toBe(false);
  });

  it("keep their record until their expiry plus a grace, never less than the floor", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(tokenRecordTtl(Date.parse("2026-11-17T08:00:00Z"), now)).toBe(TTL.mcpToken);
    // A judging end months away: the record outlives it.
    const later = Date.parse("2027-03-01T00:00:00Z");
    const ttl = tokenRecordTtl(later, now);
    expect(now + ttl * 1000).toBeGreaterThanOrEqual(later + TOKEN_RECORD_GRACE_SECONDS * 1000);
    expect(ttl).toBeGreaterThan(TTL.mcpToken);
    // Already past its expiry (a revoke after judging): the floor.
    expect(tokenRecordTtl(now - DAY_SECONDS * 1000, now)).toBe(TTL.mcpToken);
  });
});
