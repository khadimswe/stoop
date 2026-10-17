import { describe, expect, it } from "vitest";
import { describeStore } from "./contract";
import { fakeUpstash } from "./fake-upstash";
import { UpstashStore } from "./upstash";

let now = Date.parse("2026-10-17T12:00:00.000Z");
const url = "https://stoop-test.upstash.io";
describeStore("upstash", (clock) => new UpstashStore({ url, token: "t", fetch: fakeUpstash({ now: clock.now, token: "t" }).fetch }), {
  advance: (ms) => void (now += ms),
  now: () => now,
});

describe("UpstashStore", () => {
  it("sends JSON it encoded itself, and creates a counter's TTL in one transaction", async () => {
    const fake = fakeUpstash({ now: () => now });
    const store = new UpstashStore({ url, token: "t", fetch: fake.fetch });
    await store.set("k", "123", { ttlSeconds: 60, ifAbsent: true });
    await store.incr("c", { ttlSeconds: 60 });
    expect(fake.commands).toEqual([
      ["SET", "k", '"123"', "EX", 60, "NX"],
      ["SET", "c", 0, "EX", 60, "NX"],
      ["INCRBY", "c", 1],
    ]);
  });

  it("never puts the URL or token in an error", async () => {
    const token = "secret-token-value";
    const store = new UpstashStore({ url, token, fetch: fakeUpstash({ now: () => now, token: "another" }).fetch });
    const error = await store.get("k").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain(token);
    expect(String((error as Error).message)).not.toContain("upstash.io");
    const offline = new UpstashStore({ url, token, fetch: (async () => { throw new Error(`connect ECONNREFUSED ${url}?token=${token}`); }) as typeof fetch });
    const down = await offline.get("k").catch((e: Error) => e.message);
    expect(down).not.toContain(token);
    expect(down).not.toContain("upstash.io");
    expect(await offline.ping()).toBe(false);
  });

  it("surfaces a Redis error, such as reading a list as a value", async () => {
    const store = new UpstashStore({ url, token: "t", fetch: fakeUpstash({ now: () => now }).fetch });
    await store.append("l", [1]);
    await expect(store.get("l")).rejects.toThrow(/WRONGTYPE/);
  });
});
