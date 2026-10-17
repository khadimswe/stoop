import { describe, expect, it } from "vitest";
import { hitRate, type RateRule } from "./rate-limit";
import { MemoryStore } from "./store/memory";
import type { VisitorId } from "./store/visitor";

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
