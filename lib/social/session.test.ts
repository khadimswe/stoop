// The Meta connection's own pieces: the return path, the signed OAuth state and its cookie nonce, the
// signed session cookie, and the sealed token record (no token in the store's plain text).
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { keys } from "../store/keys";
import { FAKE_TOKENS } from "./fake-meta";
import { connectionTtlSeconds, loadConnection, mintSession, mintState, readSession, safeReturnPath, saveConnection, seal, STATE_TTL_SECONDS, unseal, verifyState, type MetaConnection } from "./session";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-10-28T15:00:00Z");

const connection: MetaConnection = {
  v: 1,
  user: { token: FAKE_TOKENS.user, expiresAt: NOW + 60 * 86_400_000 },
  pages: [{ id: "111", name: "Corner Wireless", token: FAKE_TOKENS.page, canPost: true, instagram: { id: "17841400000000001", username: "cornerwireless" } }],
  connectedAt: new Date(NOW).toISOString(),
};

describe("the return path", () => {
  it("keeps paths on this site and drops everything else", () => {
    expect(safeReturnPath("/plan/plan_0123?tab=post")).toBe("/plan/plan_0123?tab=post");
    for (const bad of [null, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "/a b", "plan/x", "/x\n", "/.//evil.example", "/..//evil.example", "/%2e%2e//evil.example", "/%2E//evil.example/x"]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
    expect(safeReturnPath("/plan/../e/plan_1")).toBe("/e/plan_1");
  });
});

describe("the OAuth state", () => {
  it("round-trips with the browser's nonce and carries the return path", () => {
    const { state, nonce } = mintState(SECRET, "/plan/plan_1", NOW);
    expect(verifyState(SECRET, state, nonce, NOW + 60_000)).toEqual({ returnTo: "/plan/plan_1" });
  });

  it("is refused with another browser's nonce, no cookie, after it expires, tampered or under another secret", () => {
    const { state, nonce } = mintState(SECRET, "/plan/plan_1", NOW);
    const other = mintState(SECRET, "/", NOW).nonce;
    expect(verifyState(SECRET, state, other, NOW)).toBeNull();
    expect(verifyState(SECRET, state, null, NOW)).toBeNull();
    expect(verifyState(SECRET, state, nonce, NOW + (STATE_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifyState(SECRET, state.replace(/\.([^.]+)\.([^.]+)$/, `.${Buffer.from("//evil.example").toString("base64url")}.$2`), nonce, NOW)).toBeNull();
    expect(verifyState("t".repeat(40), state, nonce, NOW)).toBeNull();
  });
});

describe("the session cookie", () => {
  it("carries a random id this server signed", () => {
    const { id, value } = mintSession(SECRET);
    expect(id).toMatch(/^m_[0-9a-f]{24}$/);
    expect(readSession(SECRET, value)).toBe(id);
    expect(readSession(SECRET, `${id}.AAAA`)).toBeNull();
    expect(readSession("t".repeat(40), value)).toBeNull();
    expect(readSession(null, value)).toBeNull();
  });
});

describe("the stored tokens", () => {
  it("are sealed: the store's value holds no token, and only this id and secret open it", () => {
    const sealed = seal(SECRET, "m_000000000000000000000001", connection);
    const text = JSON.stringify(sealed);
    expect(text).not.toContain(FAKE_TOKENS.user);
    expect(text).not.toContain(FAKE_TOKENS.page);
    expect(unseal(SECRET, "m_000000000000000000000001", sealed)).toEqual(connection);
    expect(unseal(SECRET, "m_000000000000000000000002", sealed)).toBeNull();
    expect(unseal("t".repeat(40), "m_000000000000000000000001", sealed)).toBeNull();
    expect(unseal(SECRET, "m_000000000000000000000001", { ...sealed, data: sealed.data.slice(2) })).toBeNull();
  });

  it("live in the store until judging ends, then nothing more is stored", async () => {
    const store = new MemoryStore();
    const id = "m_000000000000000000000001";
    const until = NOW + 20 * 86_400_000;
    await saveConnection(store, SECRET, id, connection, connectionTtlSeconds(until, NOW));
    expect(await loadConnection(store, SECRET, id)).toEqual(connection);
    expect(JSON.stringify(await store.get(keys.social.metaSession(id)))).not.toContain(FAKE_TOKENS.page);
    expect(connectionTtlSeconds(until, NOW)).toBe(20 * 86_400);
    expect(connectionTtlSeconds(until, until + 1)).toBe(0);
    await expect(saveConnection(store, SECRET, id, connection, 0)).rejects.toThrow();
  });
});
