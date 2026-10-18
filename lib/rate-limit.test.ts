import { describe, expect, it } from "vitest";
import { giveBack, hitRate, reserveEach, reserveUpTo, type RateRule } from "./rate-limit";
import { MemoryStore } from "./store/memory";
import type { VisitorId } from "./store/visitor";

describe("reservations", () => {
  it("reserveUpTo grants what fits under the cap and gives the rest back at once, even under concurrent takers", async () => {
    const store = new MemoryStore();
    expect(await reserveUpTo(store, "k", 10, 25, 60)).toBe(10);
    const grants = await Promise.all(Array.from({ length: 5 }, () => reserveUpTo(store, "k", 10, 25, 60)));
    expect(grants.reduce((a, b) => a + b, 0)).toBe(15);
    expect(await store.get("k")).toBe(25);
    await giveBack(store, "k", 7, 60);
    expect(await store.get("k")).toBe(18);
    await giveBack(store, "k", 0);
    expect(await reserveUpTo(store, "k", 0, 25, 60)).toBe(0);
  });

  it("reserveEach takes one unit from every counter or none, names the full one, and releases once", async () => {
    const store = new MemoryStore();
    const counters = [
      { name: "narrow", key: "a", cap: 2, ttlSeconds: 60 },
      { name: "shared", key: "b", cap: 3, ttlSeconds: 60 },
    ] as const;
    const results = await Promise.all(Array.from({ length: 5 }, () => reserveEach(store, counters)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? null : r.full))).toEqual(["narrow", "narrow", "narrow"]);
    expect(await store.get("a")).toBe(2);
    expect(await store.get("b")).toBe(2);
    const held = results.find((r) => r.ok);
    if (!held?.ok) throw new Error("expected a reservation");
    await held.reservation.release();
    await held.reservation.release();
    expect(await store.get("a")).toBe(1);
    expect(await store.get("b")).toBe(1);
    // The shared counter full: the narrow one is given back.
    await store.incr("b", { by: 2 });
    expect(await reserveEach(store, counters)).toEqual({ ok: false, full: "shared" });
    expect(await store.get("a")).toBe(1);
  });
});

const rule: RateRule = { name: "test", limit: 3, windowSeconds: 60 };
const ana = "v_aaaaaaaaaaaaaaaaaaaaaaaa" as VisitorId;
const ben = "v_bbbbbbbbbbbbbbbbbbbbbbbb" as VisitorId;

describe("hitRate", () => {
  it("allows the limit per window per visitor, then refuses with the seconds left", async () => {
    let now = 1_000 * 60_000 + 15_000; // 15 s into a window
    const store = new MemoryStore({ now: () => now });
    for (let i = 1; i <= 3; i++) expect(await hitRate(store, rule, ana, now)).toEqual({ ok: true, count: i, retryAfterSeconds: 45 });
    expect(await hitRate(store, rule, ana, now)).toMatchObject({ ok: false, count: 4 });
    expect((await hitRate(store, rule, ben, now)).ok).toBe(true);
    now += 45_000; // the next window
    expect(await hitRate(store, rule, ana, now)).toEqual({ ok: true, count: 1, retryAfterSeconds: 60 });
  });
});
