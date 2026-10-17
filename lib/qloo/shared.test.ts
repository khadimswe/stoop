import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryStore } from "../store/memory";
import { keys } from "../store/keys";
import { createQlooClient } from "./client";
import { ENDPOINTS } from "./constants";
import { createRunContext } from "./context";
import { QlooBudgetError } from "./errors";
import { DAILY_CAP_MESSAGE, lastMonthRemaining, sharedClientOptions } from "./shared";

const ID = "AFBD8046-1234-4ABC-9DEF-0123456789AB";
const params = (i: number) => ({ "filter.type": "urn:entity:artist", "signal.interests.entities": [ID], take: i + 1 }) as const;

function setup(dailyCap: number) {
  let clock = Date.parse("2026-10-17T12:00:00.000Z");
  const store = new MemoryStore({ now: () => clock });
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
    clock += ms;
  };
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches++;
    return new Response("{}", { status: 200, headers: { "x-month-ratelimit-remaining": String(9000 - fetches) } });
  }) as typeof fetch;
  const shared = sharedClientOptions(store, { dailyCap, sleep, now: () => clock });
  // Two instances share the store, as two serverless functions would.
  const one = createQlooClient({ apiKey: "not-a-real-qloo-key", fetch: fetchImpl, now: () => clock, sleep, ...shared });
  const two = createQlooClient({ apiKey: "not-a-real-qloo-key", fetch: fetchImpl, now: () => clock, sleep, ...shared });
  return { store, one, two, waits, fetches: () => fetches };
}

describe("the shared Qloo client options", () => {
  it("spaces starts 250 ms apart across instances", async () => {
    const { one, two, waits } = setup(100);
    const ctx = createRunContext({ runId: "run_a" });
    await Promise.all([0, 1, 2, 3].map((i) => (i % 2 ? one : two).request(ctx, { endpoint: ENDPOINTS.insights, params: params(i), schema: z.unknown() })));
    expect([...waits].sort((a, b) => a - b)).toEqual([250, 500, 750]);
  });

  it("serves a repeat from the shared cache on another instance, without spending the daily cap", async () => {
    const { store, one, two, fetches } = setup(100);
    await one.request(createRunContext({ runId: "run_a" }), { endpoint: ENDPOINTS.insights, params: params(0), schema: z.unknown() });
    const result = await two.request(createRunContext({ runId: "run_b" }), { endpoint: ENDPOINTS.insights, params: params(0), schema: z.unknown() });
    expect(result.evidence.cached).toBe(true);
    expect(fetches()).toBe(1);
    expect(await store.get(keys.daily("qloo", "2026-10-17"))).toBe(1);
  });

  it("refuses fresh calls once the day's cap is spent, and remembers the month remaining", async () => {
    const { store, one, fetches } = setup(2);
    const ctx = createRunContext({ runId: "run_a" });
    await one.request(ctx, { endpoint: ENDPOINTS.insights, params: params(0), schema: z.unknown() });
    await one.request(ctx, { endpoint: ENDPOINTS.insights, params: params(1), schema: z.unknown() });
    const third = one.request(ctx, { endpoint: ENDPOINTS.insights, params: params(2), schema: z.unknown() });
    await expect(third).rejects.toBeInstanceOf(QlooBudgetError);
    await expect(third).rejects.toThrow(DAILY_CAP_MESSAGE);
    expect(fetches()).toBe(2);
    expect(await lastMonthRemaining(store)).toBe(8998);
  });
});
