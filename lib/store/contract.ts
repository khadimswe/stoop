// The conformance suite every Store adapter passes: MemoryStore here, UpstashStore (against a mocked
// REST layer) in its own test. Test-only: imported from *.test.ts files.
import { describe, expect, it } from "vitest";
import type { Store } from "./types";

/** `make` gets a clock it can move, so TTLs are tested without waiting. */
export function describeStore(name: string, make: (clock: { now: () => number }) => Store, options: { advance: (ms: number) => Promise<void> | void; now: () => number }) {
  const clock = { now: options.now };

  describe(`${name} store`, () => {
    it("reads back a copy of what it wrote, and null for a missing key", async () => {
      const store = make(clock);
      const value = { a: 1, list: ["x"], nested: { ok: true } };
      expect(await store.set("k", value)).toBe(true);
      const read = await store.get<typeof value>("k");
      expect(read).toEqual(value);
      read!.list.push("changed");
      expect(await store.get("k")).toEqual(value);
      expect(await store.get("missing")).toBeNull();
    });

    it("keeps strings that look like numbers or booleans as strings", async () => {
      const store = make(clock);
      for (const value of ["123", "true", "null", "", "0x1f"]) {
        await store.set("k", value);
        expect(await store.get("k")).toBe(value);
      }
      await store.append("l", ["123", 123, "false"]);
      expect(await store.range("l", 0, -1)).toEqual(["123", 123, "false"]);
    });

    it("writes only when absent with ifAbsent, and deletes", async () => {
      const store = make(clock);
      expect(await store.set("k", "first", { ifAbsent: true })).toBe(true);
      expect(await store.set("k", "second", { ifAbsent: true })).toBe(false);
      expect(await store.get("k")).toBe("first");
      await store.del("k");
      expect(await store.get("k")).toBeNull();
      expect(await store.set("k", "third", { ifAbsent: true })).toBe(true);
    });

    it("expires a value after its TTL", async () => {
      const store = make(clock);
      await store.set("k", "v", { ttlSeconds: 10 });
      await options.advance(9_000);
      expect(await store.get("k")).toBe("v");
      await options.advance(1_000);
      expect(await store.get("k")).toBeNull();
      expect(await store.set("k", "again", { ifAbsent: true })).toBe(true);
    });

    it("moves a TTL with expire, and leaves a missing key missing", async () => {
      const store = make(clock);
      await store.incr("c", { ttlSeconds: 10 });
      await options.advance(8_000);
      await store.expire("c", 10);
      await options.advance(8_000);
      expect(await store.get("c")).toBe(1);
      await options.advance(2_000);
      expect(await store.get("c")).toBeNull();
      await store.expire("missing", 10);
      expect(await store.get("missing")).toBeNull();
    });

    it("counts, with the TTL fixed at the counter's first use", async () => {
      const store = make(clock);
      expect(await store.incr("c", { ttlSeconds: 10 })).toBe(1);
      await options.advance(6_000);
      expect(await store.incr("c", { ttlSeconds: 10, by: 2 })).toBe(3);
      expect(await store.get("c")).toBe(3);
      await options.advance(4_000);
      expect(await store.incr("c", { ttlSeconds: 10 })).toBe(1);
    });

    it("appends to a list and reads ranges with inclusive, negative-friendly indexes", async () => {
      const store = make(clock);
      expect(await store.append("l", [{ seq: 0 }, { seq: 1 }])).toBe(2);
      expect(await store.append("l", [{ seq: 2 }])).toBe(3);
      expect(await store.length("l")).toBe(3);
      expect(await store.range("l", 0, -1)).toEqual([{ seq: 0 }, { seq: 1 }, { seq: 2 }]);
      expect(await store.range("l", 1, 1)).toEqual([{ seq: 1 }]);
      expect(await store.range("l", 2, 10)).toEqual([{ seq: 2 }]);
      expect(await store.range("l", -2, -1)).toEqual([{ seq: 1 }, { seq: 2 }]);
      expect(await store.range("l", 5, -1)).toEqual([]);
      expect(await store.range("none", 0, -1)).toEqual([]);
      expect(await store.length("none")).toBe(0);
    });

    it("appends nothing without writing", async () => {
      const store = make(clock);
      expect(await store.append("l", [])).toBe(0);
      expect(await store.length("l")).toBe(0);
      await store.append("l", [1]);
      expect(await store.append("l", [])).toBe(1);
    });

    it("spaces reserved slots so starts never bunch up, across any number of callers", async () => {
      const store = make(clock);
      const now = options.now();
      const waits = await Promise.all(Array.from({ length: 4 }, () => store.reserveSlot("pacer", 250, { now })));
      expect([...waits].sort((a, b) => a - b)).toEqual([0, 250, 500, 750]);
      // Once the clock passes the reserved slots, the next start is immediate again.
      expect(await store.reserveSlot("pacer", 250, { now: now + 2_000 })).toBe(0);
      expect(await store.reserveSlot("pacer", 250, { now: now + 2_100 })).toBe(150);
    });

    it("refreshes a list's TTL on every append", async () => {
      const store = make(clock);
      await store.append("l", [1], { ttlSeconds: 10 });
      await options.advance(8_000);
      await store.append("l", [2], { ttlSeconds: 10 });
      await options.advance(8_000);
      expect(await store.range("l", 0, -1)).toEqual([1, 2]);
      await options.advance(2_000);
      expect(await store.length("l")).toBe(0);
    });

    it("admits at most max leases, refreshes a holder, and frees expired or released ones", async () => {
      const store = make(clock);
      const lease = { max: 2, ttlMs: 60_000 };
      expect(await store.leaseAcquire("leases", "run-a", { ...lease, now: options.now() })).toBe(true);
      expect(await store.leaseAcquire("leases", "run-b", { ...lease, now: options.now() })).toBe(true);
      expect(await store.leaseAcquire("leases", "run-c", { ...lease, now: options.now() })).toBe(false);
      // A holder refreshes its own lease even when the set is full.
      expect(await store.leaseAcquire("leases", "run-a", { ...lease, now: options.now() + 30_000 })).toBe(true);
      expect(await store.leaseCount("leases", options.now())).toBe(2);
      // run-b expires at +60 s; run-a was refreshed to +90 s.
      expect(await store.leaseCount("leases", options.now() + 60_000)).toBe(1);
      expect(await store.leaseAcquire("leases", "run-c", { ...lease, now: options.now() + 60_000 })).toBe(true);
      await store.leaseRelease("leases", "run-a");
      expect(await store.leaseCount("leases", options.now() + 60_000)).toBe(1);
    });

    it("tells whether a member holds a live lease, without refreshing it", async () => {
      const store = make(clock);
      await store.leaseAcquire("held", "run-a", { max: 2, ttlMs: 60_000, now: options.now() });
      expect(await store.leaseHeld("held", "run-a", options.now() + 59_000)).toBe(true);
      expect(await store.leaseHeld("held", "run-a", options.now() + 60_000)).toBe(false);
      expect(await store.leaseHeld("held", "run-b", options.now())).toBe(false);
      expect(await store.leaseHeld("none", "run-a", options.now())).toBe(false);
    });

    it("answers a ping", async () => {
      expect(await make(clock).ping()).toBe(true);
    });
  });
}
