import { describe, expect, it } from "vitest";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { saltedHash } from "../store/visitor";
import { listTokens, revokeByEmail, revokeByLabel } from "./admin";
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
      expect(printed).not.toContain(t.token.slice(8));
      expect(printed).not.toContain(t.hash);
    }
  });

  it("revoke one token by its label prefix, refusing prefixes that are too short or ambiguous", async () => {
    const store = new MemoryStore();
    const a = await storeToken(store);
    const b = await storeToken(store);
    expect(await revokeByLabel(store, "stp_", NOW)).toEqual({ outcome: "too-short" });
    expect(await revokeByLabel(store, "xyz_abcd", NOW)).toEqual({ outcome: "too-short" });
    expect(await revokeByLabel(store, "stp_~~", NOW)).toEqual({ outcome: "none" });
    // Two labels sharing a prefix: nothing is revoked until the prefix tells them apart.
    const shared = await storeToken(store, { label: `${a.record.label.slice(0, 6)}${a.record.label[6] === "Z" ? "Y" : "Z"}${a.record.label[7]}` });
    expect((await revokeByLabel(store, a.record.label.slice(0, 6), NOW)).outcome).toBe("ambiguous");
    const result = await revokeByLabel(store, a.record.label, NOW);
    expect(result).toMatchObject({ outcome: "revoked", revoked: [{ label: a.record.label, status: "revoked", revokedAt: new Date(NOW).toISOString() }] });
    expect(await identify(store, bearer(a.token), NOW)).toEqual({ status: "revoked" });
    expect((await identify(store, bearer(b.token), NOW)).status).toBe("valid");
    expect((await identify(store, bearer(shared.token), NOW)).status).toBe("valid");
    // Revoking again changes nothing.
    expect(await revokeByLabel(store, a.record.label, NOW)).toEqual({ outcome: "revoked", revoked: [] });
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
