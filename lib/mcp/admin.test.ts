import { describe, expect, it } from "vitest";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { saltedHash } from "../store/visitor";
import { listTokens, revokeByEmail, revokeOne } from "./admin";
import { identify } from "./auth";
import { storeToken } from "./fixture-token";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` });

describe("the founder's token tools", () => {
  it("list labels, dates and statuses, never a token or a hash", async () => {
    const store = new MemoryStore();
    const active = await storeToken(store, { issuedAt: "2026-10-20T00:00:00.000Z" });
    const revoked = await storeToken(store, { issuedAt: "2026-10-21T00:00:00.000Z", revokedAt: "2026-10-22T00:00:00.000Z" });
    const expired = await storeToken(store, { issuedAt: "2026-10-19T00:00:00.000Z", expiresAt: "2026-10-24T00:00:00.000Z" });
    // A listed hash whose record is gone is skipped.
    await store.append(keys.mcp.tokens, ["0".repeat(64)]);
    const listing = await listTokens(store, NOW);
    expect(listing.map((t) => [t.label, t.status])).toEqual([
      [expired.record.label, "expired"],
      [active.record.label, "active"],
      [revoked.record.label, "revoked"],
    ]);
    const printed = JSON.stringify(listing);
    for (const t of [active, revoked, expired]) {
      // Labels and references come from the hash: no character run of the token, and never the whole hash.
      expect(t.record.label).toBe(`stp_${t.hash.slice(0, 4)}`);
      expect(printed).not.toContain(t.token.slice(4, 12));
      expect(printed).not.toContain(t.hash);
      expect(listing.find((l) => l.label === t.record.label)?.ref).toBe(t.hash.slice(0, 12));
    }
  });

  it("revoke one token by label or reference, refusing prefixes that are too short or match more than one", async () => {
    const store = new MemoryStore();
    const a = await storeToken(store);
    const b = await storeToken(store);
    expect(await revokeOne(store, "stp_", NOW)).toEqual({ outcome: "too-short" });
    expect(await revokeOne(store, "abc", NOW)).toEqual({ outcome: "too-short" });
    expect(await revokeOne(store, "xyz_abcd", NOW)).toEqual({ outcome: "too-short" });
    expect(await revokeOne(store, "stp_~~", NOW)).toEqual({ outcome: "none" });
    // Two tokens with the same label (labels are short): the label is ambiguous, the reference picks one.
    const twin = await storeToken(store, { label: a.record.label });
    expect((await revokeOne(store, a.record.label, NOW)).outcome).toBe("ambiguous");
    const result = await revokeOne(store, a.hash.slice(0, 10), NOW);
    expect(result).toMatchObject({ outcome: "revoked", revoked: [{ label: a.record.label, ref: a.hash.slice(0, 12), status: "revoked", revokedAt: new Date(NOW).toISOString() }] });
    expect(await identify(store, bearer(a.token), NOW)).toEqual({ status: "revoked" });
    expect((await identify(store, bearer(twin.token), NOW)).status).toBe("valid");
    // A unique label revokes its one token.
    expect((await revokeOne(store, b.record.label, NOW)).outcome).toBe(b.record.label === a.record.label ? "ambiguous" : "revoked");
    // Revoking again changes nothing.
    expect(await revokeOne(store, a.hash.slice(0, 10), NOW)).toEqual({ outcome: "revoked", revoked: [] });
  });

  it("revoke every token issued to an email, found by its salted hash", async () => {
    const store = new MemoryStore();
    const email = await saltedHash(store, "ana@shop.example");
    const first = await storeToken(store, { email });
    const second = await storeToken(store, { email });
    const other = await storeToken(store);
    const revoked = await revokeByEmail(store, " ANA@Shop.example", NOW);
    expect(revoked.map((t) => t.label).sort()).toEqual([first.record.label, second.record.label].sort());
    expect((await identify(store, bearer(first.token), NOW)).status).toBe("revoked");
    expect((await identify(store, bearer(second.token), NOW)).status).toBe("revoked");
    expect((await identify(store, bearer(other.token), NOW)).status).toBe("valid");
    expect(await revokeByEmail(store, "nobody@shop.example", NOW)).toEqual([]);
  });
});
