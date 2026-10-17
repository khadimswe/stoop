// Client behavior with a mocked fetch. Responses carry status codes, headers, and empty or trivial
// bodies only: no Qloo-shaped data is invented here. Shape parsing against real recorded responses
// is tested in types.test.ts.
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MemoryCache } from "./cache";
import { createQlooClient, type QlooClientOptions } from "./client";
import { ENDPOINTS } from "./constants";
import { RUN_BUDGET, RUN_CAP } from "./budget";
import { createLiveRunContext, createRunContext } from "./context";
import { QlooBudgetError, QlooConfigError, QlooHttpError, QlooParamError, QlooShapeError } from "./errors";
import { createLimiter, type Limiter } from "./limiter";
import type { QlooParams } from "./params";

// Deliberately fake and low-entropy so secret scanners do not flag the test.
const KEY = "not-a-real-qloo-key";
const ID = "AFBD8046-1234-4ABC-9DEF-0123456789AB";
const ID2 = "0C1D2E3F-4A5B-4C6D-8E7F-9A0B1C2D3E4F";

const artistParams = (id = ID): QlooParams => ({ "filter.type": "urn:entity:artist", "signal.interests.entities": [id] });

type Reply = Response | Error;

function setup(replies: Reply[], options: Partial<QlooClientOptions> = {}) {
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected extra fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  // No pacing by default so retry delays are easy to read. Pacing has its own tests.
  const passThrough: Limiter = { run: (_key, task) => task(), pace: async () => {}, inFlight: () => false };
  const client = createQlooClient({
    apiKey: KEY,
    fetch: fetchMock as unknown as typeof fetch,
    now,
    sleep,
    random: () => 0,
    limiter: passThrough,
    cache: new MemoryCache(now),
    ...options,
  });
  return { client, fetchMock, sleep, ctx: createRunContext({ runId: "run_test" }) };
}

const ok = (headers: Record<string, string> = {}) => new Response("{}", { status: 200, headers });
const status = (code: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status: code, headers });
const anything = z.unknown();

describe("configuration", () => {
  it("throws QLOO_API_KEY missing at the first live request, without calling fetch", async () => {
    const { client, fetchMock, ctx } = setup([], { apiKey: undefined });
    await expect(client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })).rejects.toThrow(
      new QlooConfigError("QLOO_API_KEY missing"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.liveCalls).toBe(0);
  });

  it("treats a blank key as missing", async () => {
    const { client, ctx } = setup([], { apiKey: "   " });
    await expect(client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })).rejects.toThrow(
      "QLOO_API_KEY missing",
    );
  });

  it("rejects bad params before any network call", async () => {
    const { client, fetchMock, ctx } = setup([]);
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: { "filter.type": "urn:entity:video_game" }, schema: anything }),
    ).rejects.toBeInstanceOf(QlooParamError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("request and evidence", () => {
  it("sends the key only as a header and returns an evidence receipt", async () => {
    const { client, fetchMock, ctx } = setup([ok()]);
    const { evidence } = await client.request(ctx, {
      endpoint: ENDPOINTS.insights,
      params: artistParams(),
      schema: anything,
      label: "Finding artists",
      stage: "culture",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Aartist&signal.interests.entities=${ID}`,
    );
    expect(String(url)).not.toContain(KEY);
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe(KEY);
    expect(init?.redirect).toBe("error");

    expect(evidence.id).toMatch(/^ev_[0-9a-f]{12}$/);
    expect(evidence).toMatchObject({
      endpoint: "/v2/insights",
      params: { "filter.type": "urn:entity:artist", "signal.interests.entities": ID },
      label: "Finding artists",
      stage: "culture",
      status: 200,
      cached: false,
    });
    expect(ctx.liveCalls).toBe(1);
    expect(ctx.stageCalls).toEqual({ culture: 1 });
    expect(JSON.stringify(ctx.ledger.entries)).not.toContain(KEY);
  });

  it("serves repeats from cache, marked cached, without spending a call", async () => {
    const { client, fetchMock, ctx } = setup([ok()]);
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything };
    await client.request(ctx, req);
    const second = await client.request(ctx, req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.evidence.cached).toBe(true);
    expect(ctx.liveCalls).toBe(1);
    expect(ctx.cachedCalls).toBe(1);
  });

  it("captures the monthly quota Qloo reports", async () => {
    const { client, ctx } = setup([ok({ "x-month-ratelimit-remaining": "9876" })]);
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(ctx.monthRemaining).toBe(9876);
  });

  it("throws a shape error instead of passing unexpected data on, and does not cache the bad body", async () => {
    const { client, fetchMock, ctx } = setup([ok(), ok()]);
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: z.object({ results: z.array(z.unknown()) }) };
    await expect(client.request(ctx, req)).rejects.toBeInstanceOf(QlooShapeError);
    await expect(client.request(ctx, req)).rejects.toBeInstanceOf(QlooShapeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the not-found value for a 404 and caches it", async () => {
    const { client, fetchMock, ctx } = setup([status(404)]);
    const req = {
      endpoint: ENDPOINTS.search,
      params: { query: "Nothing Like This", types: ["urn:entity:brand"] },
      schema: z.array(z.unknown()),
      onNotFound: [] as unknown[],
    };
    const first = await client.request(ctx, req);
    const second = await client.request(ctx, req);
    expect(first.data).toEqual([]);
    expect(first.evidence.status).toBe(404);
    expect(second.evidence.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("retries", () => {
  it("retries a 429 and honors Retry-After", async () => {
    const { client, fetchMock, sleep, ctx } = setup([status(429, "", { "retry-after": "2" }), ok()]);
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(ctx.liveCalls).toBe(2);
  });

  it("ignores an implausible rate-limit reset value and backs off instead", async () => {
    const { client, fetchMock, sleep, ctx } = setup([status(429, "", { "x-second-ratelimit-reset": "1760000000" }), ok()]);
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("does not retry a 500, which Qloo returns deterministically", async () => {
    const { client, fetchMock, ctx } = setup([status(500, "System Error")]);
    const error = await client
      .request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooHttpError);
    expect((error as QlooHttpError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up on a 503 after 3 retries with exponential backoff", async () => {
    const { client, fetchMock, sleep, ctx } = setup([status(503), status(503), status(503), status(503)]);
    await expect(client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })).rejects.toThrow(
      QlooHttpError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    expect(ctx.liveCalls).toBe(4);
  });

  it("fails fast when Retry-After is longer than the wait cap", async () => {
    const { client, fetchMock, sleep, ctx } = setup([status(429, "", { "retry-after": "3600" })]);
    const error = await client
      .request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooHttpError);
    expect((error as QlooHttpError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("times out a stalled body instead of hanging the run", async () => {
    const stalled = () => new Response(new ReadableStream({ start() {} }), { status: 200 });
    const { client, ctx } = setup([stalled()], { timeoutMs: 20, maxRetries: 0 });
    const error = await client
      .request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QlooHttpError);
    expect((error as Error).message).toContain("timed out after 20 ms");
  });

  it("retries network errors", async () => {
    const { client, fetchMock, ctx } = setup([new TypeError("fetch failed"), ok()]);
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast on other 4xx with the key redacted from the message", async () => {
    const { client, fetchMock, ctx } = setup([status(400, `bad request for ${KEY}`)]);
    const error = (await client
      .request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(QlooHttpError);
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain("[redacted]");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("budget", () => {
  it("stops a run at its cap of live calls", async () => {
    const { client, fetchMock } = setup([ok(), ok()]);
    const ctx = createRunContext({ runId: "run_capped", cap: 2 });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything });
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: { ...artistParams(ID), take: 5 }, schema: anything }),
    ).rejects.toBeInstanceOf(QlooBudgetError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never lets retries push a run past its cap, even in parallel", async () => {
    const { client, fetchMock } = setup([status(503), status(503), status(503), ok(), ok(), ok()]);
    const ctx = createRunContext({ runId: "run_storm", cap: 3 });
    const results = await Promise.allSettled(
      [ID, ID2, "11111111-2222-4333-8444-555555555555"].map((id) =>
        client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(id), schema: anything }),
      ),
    );
    expect(ctx.liveCalls).toBeLessThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 503 });
    }
  });

  it("spends the last of the budget on a retry, then stops new requests", async () => {
    const { client, fetchMock } = setup([status(503), ok()]);
    const ctx = createRunContext({ runId: "run_tight", cap: 2 });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything });
    expect(ctx.liveCalls).toBe(2);
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything }),
    ).rejects.toBeInstanceOf(QlooBudgetError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a call once its budget row is spent, while other rows go on", async () => {
    const { client, fetchMock } = setup([ok(), ok(), ok()]);
    const ctx = createRunContext({ runId: "run_rows", rowCaps: { probes: 1, scoring: 2 } });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything, budgetRow: "probes" });
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything, budgetRow: "probes" }),
    ).rejects.toThrow(new QlooBudgetError("Run run_rows spent its 1 probes calls"));
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything, budgetRow: "scoring" });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: { ...artistParams(ID), take: 5 }, schema: anything, budgetRow: "scoring" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(ctx.rowCalls).toEqual({ probes: 1, scoring: 2 });
  });

  it("draws a retry on the run cap's slack, not on the row", async () => {
    const { client, fetchMock } = setup([status(503), ok()]);
    const ctx = createRunContext({ runId: "run_row_retry", cap: 3, rowCaps: { probes: 1 } });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything, budgetRow: "probes" });
    expect(ctx.rowCalls.probes).toBe(1);
    expect(ctx.liveCalls).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops retrying once the retries have used the cap's unplanned calls", async () => {
    const { client, fetchMock } = setup([status(503), status(503), status(503), ok()]);
    // 3 calls of cap, 2 planned in rows: one retry of slack.
    const ctx = createRunContext({ runId: "run_slack", cap: 3, rowCaps: { probes: 2 } });
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything, budgetRow: "probes" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(ctx.retryCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a call with no row, or an unknown one, in a run with a budget table", async () => {
    const { client, fetchMock } = setup([]);
    const ctx = createLiveRunContext("run_live");
    await expect(client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything })).rejects.toThrow(/names no budget row/);
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything, budgetRow: "critique" as never }),
    ).rejects.toThrow(/no budget row "critique"/);
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything, budgetRow: "toString" as never }),
    ).rejects.toThrow(/no budget row "toString"/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.rowCaps).toEqual(RUN_BUDGET);
    expect(ctx.cap).toBe(RUN_CAP);
  });

  it("does not count cached calls against the cap", async () => {
    const { client } = setup([ok()]);
    const ctx = createRunContext({ runId: "run_one", cap: 1 });
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything };
    await client.request(ctx, req);
    await expect(client.request(ctx, req)).resolves.toMatchObject({ evidence: { cached: true } });
  });

  it("stops live calls when the monthly quota drops below the floor", async () => {
    const { client, fetchMock } = setup([ok({ "x-month-ratelimit-remaining": "120" })]);
    const ctx = createRunContext({ runId: "run_floor", monthlyFloor: 300 });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID), schema: anything });
    await expect(
      client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything }),
    ).rejects.toThrow("below the floor");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("in-flight sharing", () => {
  function realLimiter() {
    let clock = 0;
    return createLimiter({ now: () => clock, sleep: async (ms) => void (clock += ms) });
  }

  it("makes one call for identical concurrent requests and marks the joiner as shared", async () => {
    const { client, fetchMock, ctx } = setup([ok()], { limiter: realLimiter() });
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything };
    const [a, b] = await Promise.all([client.request(ctx, req), client.request(ctx, req)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({});
    expect(a.evidence.cached).toBe(false);
    expect(b.evidence).toMatchObject({ cached: true, shared: true });
    expect(ctx.liveCalls).toBe(1);
    expect(ctx.cachedCalls).toBe(1);
  });

  it("shares in-flight calls only within one run, so each run pays for its own", async () => {
    const { client, fetchMock } = setup([ok(), ok()], { limiter: realLimiter() });
    const runA = createRunContext({ runId: "run_a" });
    const runB = createRunContext({ runId: "run_b" });
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything };
    await Promise.all([client.request(runA, req), client.request(runB, req)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runA.liveCalls).toBe(1);
    expect(runB.liveCalls).toBe(1);
  });

  it("does not fail another run's request when one run is out of budget", async () => {
    const { client, fetchMock } = setup([ok()], { limiter: realLimiter() });
    const spent = createRunContext({ runId: "run_spent", cap: 0 });
    const fresh = createRunContext({ runId: "run_fresh" });
    const req = { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything };
    const [a, b] = await Promise.allSettled([client.request(spent, req), client.request(fresh, req)]);
    expect(a.status).toBe("rejected");
    expect((a as PromiseRejectedResult).reason).toBeInstanceOf(QlooBudgetError);
    expect(b.status).toBe("fulfilled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fresh.liveCalls).toBe(1);
  });
});

describe("cache failures", () => {
  it("keeps paid-for data when the cache write fails, and warns without the body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingCache = {
      get: async () => undefined,
      set: async () => {
        throw new Error("cache unavailable");
      },
    };
    const { client, ctx } = setup([ok()], { cache: failingCache });
    const result = await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(result.data).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("cache write failed");
    warn.mockRestore();
  });
});

describe("raw (fixture recorder)", () => {
  it("returns any status and keeps only rate-limit headers", async () => {
    const { client } = setup([
      status(500, "System Error", { "set-cookie": "session=abc", "x-month-ratelimit-remaining": "9000" }),
    ]);
    const response = await client.raw(ENDPOINTS.insights, artistParams());
    expect(response.status).toBe(500);
    expect(response.body).toBe("System Error");
    expect(response.headers).toEqual({ "x-month-ratelimit-remaining": "9000" });
  });

  it("can skip validation for probes", async () => {
    const { client } = setup([status(400)]);
    const response = await client.raw(ENDPOINTS.insights, { "filter.type": "urn:entity:book", "bias.trends": "high" }, { validate: false });
    expect(response.status).toBe(400);
  });

  it("still validates by default", async () => {
    const { client } = setup([]);
    await expect(client.raw(ENDPOINTS.insights, { "filter.type": "urn:entity:video_game" })).rejects.toBeInstanceOf(QlooParamError);
  });
});

describe("shared hooks: the global pacer, the daily cap and the month remaining", () => {
  it("waits on the shared pacer instead of the local one, before every attempt", async () => {
    const pacer = vi.fn(async () => {});
    const localPace = vi.fn(async () => {});
    const { client, ctx } = setup([status(503), ok()], { pacer, limiter: { run: (_key, task) => task(), pace: localPace, inFlight: () => false } });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(pacer).toHaveBeenCalledTimes(2);
    expect(localPace).not.toHaveBeenCalled();
  });

  it("asks the daily cap before every live attempt, and a spent cap stops the call before fetch", async () => {
    const admit = vi.fn(async () => {});
    const { client, ctx } = setup([status(503), ok()], { admit });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(admit).toHaveBeenCalledTimes(2);

    const spent = setup([ok()], {
      admit: async () => {
        throw new QlooBudgetError("Today's Qloo calls are spent");
      },
    });
    await expect(spent.client.request(spent.ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })).rejects.toBeInstanceOf(QlooBudgetError);
    expect(spent.fetchMock).not.toHaveBeenCalled();
    // A cached answer needs no admission.
    const cached = setup([ok()], { admit });
    await cached.client.request(cached.ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything });
    admit.mockClear();
    await cached.client.request(cached.ctx, { endpoint: ENDPOINTS.insights, params: artistParams(ID2), schema: anything });
    expect(admit).not.toHaveBeenCalled();
  });

  it("passes on each month-remaining value, and a failing listener never fails the call", async () => {
    const heard: number[] = [];
    const { client, ctx } = setup([ok({ "x-month-ratelimit-remaining": "8123" })], { onMonthRemaining: (n) => void heard.push(n) });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything });
    expect(heard).toEqual([8123]);
    expect(ctx.monthRemaining).toBe(8123);
    const failing = setup([ok({ "x-month-ratelimit-remaining": "10" })], {
      onMonthRemaining: async () => {
        throw new Error("store down");
      },
    });
    await expect(failing.client.request(failing.ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything })).resolves.toBeDefined();
  });

  it("starts a live run with the 300-call monthly floor and the last month remaining seen", async () => {
    const ctx = createLiveRunContext("run_floor", { monthRemaining: 299 });
    expect(ctx.monthlyFloor).toBe(300);
    const { client, fetchMock } = setup([ok()]);
    await expect(client.request(ctx, { endpoint: ENDPOINTS.insights, params: artistParams(), schema: anything, budgetRow: "prove" })).rejects.toThrow(/below the floor/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
