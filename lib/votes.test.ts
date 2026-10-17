import { describe, expect, it } from "vitest";
import { keys } from "./store/keys";
import { MemoryStore } from "./store/memory";
import { visitorId } from "./store/visitor";
import { castVote, cookieVoter, newVoterToken, readVotes, validVoterToken } from "./votes";

describe("voter ids", () => {
  it("accepts only tokens Stoop could have set", () => {
    const token = newVoterToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(newVoterToken()).not.toBe(token);
    expect(validVoterToken(token)).toBe(token);
    for (const bad of [null, "", "abc", `${token}0`, token.toUpperCase(), "../../etc"]) expect(validVoterToken(bad)).toBeNull();
  });

  it("hashes a cookie into its own voter id, stable per store and never the token itself", async () => {
    const store = new MemoryStore();
    const token = newVoterToken();
    const id = await cookieVoter(store, token);
    expect(id).toMatch(/^v_[0-9a-f]{24}$/);
    expect(id).not.toContain(token);
    expect(await cookieVoter(store, token)).toBe(id);
    expect(await cookieVoter(store, newVoterToken())).not.toBe(id);
    // A different store (another salt) gives another id for the same token.
    expect(await cookieVoter(new MemoryStore(), token)).not.toBe(id);
    // Never the same id as an IP visitor.
    expect(await visitorId(store, new Headers({ "x-forwarded-for": token }))).not.toBe(id);
  });
});

describe("castVote", () => {
  it("moves only the counter of the choice voted, and nothing else in the store", async () => {
    const store = new MemoryStore();
    const voter = { visitor: await visitorId(store, new Headers({ "x-forwarded-for": "203.0.113.7" })), cookie: await cookieVoter(store, newVoterToken()) };
    expect(await readVotes(store, "home-candles", null)).toMatchObject({ culture: 0, control: 0, n: 0, early: true, yours: null });
    const { counted, votes } = await castVote(store, { example: "home-candles", choice: "control" }, voter);
    expect(counted).toBe(true);
    expect(votes).toMatchObject({ culture: 0, control: 1, n: 1, yours: "control" });
    expect(await store.get(keys.votes.count("home-candles", "culture"))).toBeNull();
    expect(await store.get(keys.votes.visitor("home-candles", voter.visitor))).toBe("control");
    expect(await store.get(keys.votes.visitor("home-candles", voter.cookie))).toBe("control");
  });
});
