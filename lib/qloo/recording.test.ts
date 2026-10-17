// Record mode with a mocked fetch: the response is a trivial body, never Qloo-shaped data. What is
// tested is the bookkeeping: misses go live once and land in a fixture the strict replay then serves.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createQlooClient } from "./client";
import { ENDPOINTS } from "./constants";
import { createRunContext } from "./context";
import { FixtureCache, readFixtureFile } from "./fixtures";
import { canonicalQuery, cacheKey, type QlooParams } from "./params";
import { RecordingCache, splitRequest } from "./recording";

const KEY = "not-a-real-qloo-key";
const params: QlooParams = { "filter.type": "urn:entity:artist", "signal.interests.entities": ["AFBD8046-1234-4ABC-9DEF-0123456789AB", "0C1D2E3F-4A5B-4C6D-8E7F-9A0B1C2D3E4F"], take: 5 };
const passThrough = { run: <T>(_key: string, task: () => Promise<T>) => task(), pace: async () => {}, inFlight: () => false };

describe("record mode", () => {
  it("splits the client's readable request back into params with the same cache key", () => {
    const { endpoint, params: split } = splitRequest(`${ENDPOINTS.insights}?${canonicalQuery(params)}`);
    expect(endpoint).toBe(ENDPOINTS.insights);
    expect(cacheKey(ENDPOINTS.insights, split)).toBe(cacheKey(ENDPOINTS.insights, params));
  });

  it("answers a miss live once, writes it as a fixture, and the strict replay serves it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const cache = new RecordingCache([]);
    const client = createQlooClient({ apiKey: KEY, fetch: fetchMock as unknown as typeof fetch, cache, limiter: passThrough });
    const ctx = createRunContext({ runId: "record-test" });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params, schema: z.unknown() });
    await client.request(ctx, { endpoint: ENDPOINTS.insights, params, schema: z.unknown() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);

    const dir = mkdtempSync(path.join(tmpdir(), "stoop-record-"));
    const file = await cache.save("culture-test", "test recording", { now: new Date("2026-10-16T20:00:00.000Z"), secret: KEY, dir });
    const fixture = readFixtureFile(file as string);
    expect(fixture).toMatchObject({ name: "culture-test", probe: false, requests: [{ endpoint: ENDPOINTS.insights, status: 200 }] });

    const replay = createQlooClient({ cache: new FixtureCache([fixture], { strict: true }) });
    await expect(replay.request(createRunContext({ runId: "replay" }), { endpoint: ENDPOINTS.insights, params, schema: z.unknown() })).resolves.toMatchObject({ evidence: { cached: true } });
  });

  it("writes nothing when nothing new was recorded, and refuses to write a secret", async () => {
    const cache = new RecordingCache([]);
    expect(await cache.save("culture-empty", "nothing")).toBeNull();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ leaked: KEY }), { status: 200 }));
    const client = createQlooClient({ apiKey: KEY, fetch: fetchMock as unknown as typeof fetch, cache, limiter: passThrough });
    await client.request(createRunContext({ runId: "leak" }), { endpoint: ENDPOINTS.insights, params, schema: z.unknown() });
    await expect(cache.save("culture-leak", "leak", { secret: KEY, dir: mkdtempSync(path.join(tmpdir(), "stoop-record-")) })).rejects.toThrow(/secret appeared/);
  });
});
