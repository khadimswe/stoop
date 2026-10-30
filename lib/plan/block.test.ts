// POST /api/plan/block against a MemoryStore: bad input is a 400 with its field, today's Qloo cap is
// counted once (by the client, never reserved by the route), the cache shrugs off a nudged pin, and a
// network's fresh lookups are capped per day. The live lookup replays recorded Qloo responses.
import { describe, expect, it } from "vitest";
import { allowAll } from "../bot-check";
import type { QlooClient } from "../qloo/client";
import { dayOf, keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { networkVisitorId } from "../store/visitor";
import { describeRecorded } from "../testing/recorded";
import { BLOCK_CALLS, BLOCKS_PER_NETWORK_DAILY, blockCacheKey, postBlock, type BlockAnswer, type BlockDeps } from "./block";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { replayClient } from "./replay";

const example = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];
const noQloo = (): QlooClient => {
  throw new Error("no Qloo in this test");
};

function deps(store: MemoryStore, over: Partial<BlockDeps> = {}): BlockDeps {
  return { live: true, store: () => store, botCheck: () => allowAll, client: noQloo, env: { QLOO_DAILY_CAP: "500" }, ...over };
}

const ask = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://stoop.example/api/plan/block", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.7", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/plan/block", () => {
  it("answers a phone with letters with a 400 naming the field, never a 500", async () => {
    for (const phone of ["call me maybe", "312-555-0142 ext 4"]) {
      const response = await postBlock(ask({ store: { ...example.store, phone }, ageBands: example.ageBands }), deps(new MemoryStore()));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid", message: "Enter the phone as 10 digits, like 312-555-0142." }, field: "phone" });
    }
    const pin = await postBlock(ask({ store: { ...example.store, point: { lat: 91, lon: 0 } } }), deps(new MemoryStore()));
    expect(await pin.json()).toMatchObject({ field: "point" });
    expect((await postBlock(ask("{not json"), deps(new MemoryStore()))).status).toBe(400);
    expect((await postBlock(ask({ store: example.store }, { "content-type": "text/plain" }), deps(new MemoryStore()))).status).toBe(415);
    expect((await postBlock(ask({ store: example.store, pad: "x".repeat(5_000) }), deps(new MemoryStore()))).status).toBe(413);
  });

  it("points to an example while live maps are off", async () => {
    const body = (await (await postBlock(ask({ store: example.store }), deps(new MemoryStore(), { live: false }))).json()) as BlockAnswer;
    expect(body).toMatchObject({ mode: "example", slug: "chicago-18th-street" });
  });

  it("serves a pin nudged a few meters from the cache, and counts nothing for it", async () => {
    const store = new MemoryStore();
    const cached: BlockAnswer = { mode: "live", local: { city: null, block: null, gaps: [] }, ledger: [] };
    const pinned = { ...example.store, point: { lat: 41.8571, lon: -87.6612 } };
    await store.set(blockCacheKey(pinned, ["25_to_29", "30_to_34"]), cached);
    // About 35 m away: the same 3-decimal cell, so the same cache entry and no Qloo call.
    const nudged = { ...example.store, point: { lat: 41.8574, lon: -87.6609 } };
    expect(await (await postBlock(ask({ store: nudged }), deps(store))).json()).toEqual(cached);
    expect(await (await postBlock(ask({ store: pinned }), deps(store))).json()).toEqual(cached);
    expect(await store.get(keys.daily("qloo", dayOf()))).toBeNull();
  });

  it("starts no lookup that would not fit under today's Qloo cap, and reserves nothing on it", async () => {
    const store = new MemoryStore();
    await store.incr(keys.daily("qloo", dayOf()), { by: 500 - BLOCK_CALLS + 1 });
    const body = (await (await postBlock(ask({ store: example.store }), deps(store))).json()) as BlockAnswer;
    expect(body).toMatchObject({ mode: "example" });
    expect(await store.get(keys.daily("qloo", dayOf()))).toBe(500 - BLOCK_CALLS + 1);
    // A lookup refused for the day's cap does not use up the network's day either.
    const network = await networkVisitorId(store, new Headers({ "x-forwarded-for": "203.0.113.7" }));
    expect(await store.get(keys.rate("plan-block-daily", network, dayOf()))).toBeNull();
  });

  it("caps one network's fresh lookups per day (an IPv6 /48)", async () => {
    const store = new MemoryStore();
    const network = await networkVisitorId(store, new Headers({ "x-forwarded-for": "2001:db8:aa:1::9" }));
    await store.incr(keys.rate("plan-block-daily", network, dayOf()), { by: BLOCKS_PER_NETWORK_DAILY });
    // Another /64 in the same /48 is the same network.
    const body = (await (await postBlock(ask({ store: example.store }, { "x-forwarded-for": "2001:db8:aa:2::1" }), deps(store))).json()) as BlockAnswer;
    expect(body).toMatchObject({ mode: "example", message: expect.stringContaining("today") });
  });
});

describeRecorded("a live block lookup", () => {
  it("costs only the calls the client made, seeds the month's floor, and is cached", async () => {
    const store = new MemoryStore();
    await store.set(keys.qloo.monthRemaining(new Date().toISOString().slice(0, 7)), 40_000);
    const response = await postBlock(ask({ store: example.store, ageBands: example.ageBands }), deps(store, { client: () => replayClient("chicago-18th-street") }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as BlockAnswer;
    expect(body.mode).toBe("live");
    if (body.mode !== "live") return;
    expect(body.local.city?.artists.length).toBeGreaterThan(0);
    expect(body.local.block?.places.length).toBeGreaterThan(0);
    // The replay client counts nothing on today's cap, so anything there would be the route's own reservation.
    expect(await store.get(keys.daily("qloo", dayOf()))).toBeNull();
    expect(await store.get(blockCacheKey(example.store, example.ageBands))).toEqual(body);
  });
});
