import { describe, expect, it } from "vitest";
import { describeStore } from "./contract";
import { dayOf, keys } from "./keys";
import { MemoryStore } from "./memory";

let now = Date.parse("2026-10-17T12:00:00.000Z");
describeStore("memory", (clock) => new MemoryStore(clock), { advance: (ms) => void (now += ms), now: () => now });

describe("MemoryStore", () => {
  it("refuses a value that is not JSON, and mixing kinds on one key", async () => {
    const store = new MemoryStore();
    await expect(store.set("k", undefined)).rejects.toThrow(/JSON/);
    await store.set("k", "v");
    await expect(store.append("k", [1])).rejects.toThrow(/not a list/);
    await expect(store.incr("k")).rejects.toThrow(/not a counter/);
    await store.append("l", [1]);
    await expect(store.get("l")).rejects.toThrow(/not a value/);
  });

  it("counts whole numbers only", async () => {
    await expect(new MemoryStore().incr("c", { by: 0.5 })).rejects.toThrow(/whole numbers/);
  });
});

describe("store keys", () => {
  it("keeps one event list per attempt and names daily counters by UTC day", () => {
    expect(keys.run.events("run_abc", 2)).toBe("run:run_abc:2:events");
    expect(dayOf(Date.parse("2026-10-17T23:59:59.000Z"))).toBe("2026-10-17");
    expect(keys.daily("live-runs", "2026-10-17")).toBe("daily:live-runs:2026-10-17");
  });
});

describe("getStore", () => {
  it("refuses the in-memory store on Vercel, where instances do not share memory", async () => {
    const { getStore, setStore } = await import("./index");
    setStore(null);
    expect(() => getStore({ VERCEL: "1" })).toThrow(/local use only/);
    expect(getStore({}).kind).toBe("memory");
    setStore(null);
    expect(getStore({ VERCEL: "1", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }).kind).toBe("upstash");
    setStore(null);
  });

  it("also reads the names Vercel's Upstash integration sets", async () => {
    const { getStore, setStore } = await import("./index");
    setStore(null);
    expect(getStore({ VERCEL: "1", KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }).kind).toBe("upstash");
    setStore(null);
  });
});
