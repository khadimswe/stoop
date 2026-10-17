import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { keys } from "../store/keys";
import { readFixtureFile } from "./fixtures";
import { COMPRESS_OVER, StoreQlooCache } from "./redis-cache";

// The biggest real answer Stoop caches: a recorded US heatmap (fixtures/pool-audience).
const recorded = readFixtureFile("fixtures/pool-audience.json.gz").requests;
const largest = recorded.reduce((a, b) => (JSON.stringify(b.body ?? null).length > JSON.stringify(a.body ?? null).length ? b : a));

describe("the shared Qloo cache", () => {
  it("stores a large answer gzipped and reads it back exactly", async () => {
    const store = new MemoryStore();
    const cache = new StoreQlooCache(store);
    const entry = { status: 200, body: largest.body, fetchedAt: 1_700_000_000_000 };
    expect(JSON.stringify(entry).length).toBeGreaterThan(COMPRESS_OVER);
    await cache.set("hash-large", entry, 60_000);
    const stored = await store.get<{ gz?: string }>(keys.qloo.cache("hash-large"));
    expect(stored?.gz).toBeDefined();
    expect(stored!.gz!.length).toBeLessThan(JSON.stringify(entry).length / 3);
    expect(await cache.get("hash-large")).toEqual(entry);
  });

  it("keeps a small answer as it is, and misses what was never cached", async () => {
    const store = new MemoryStore();
    const cache = new StoreQlooCache(store);
    const entry = { status: 404, body: null, fetchedAt: 1_700_000_000_000 };
    await cache.set("hash-small", entry, 60_000);
    expect(await store.get(keys.qloo.cache("hash-small"))).toEqual(entry);
    expect(await cache.get("hash-small")).toEqual(entry);
    expect(await cache.get("hash-missing")).toBeUndefined();
  });
});
