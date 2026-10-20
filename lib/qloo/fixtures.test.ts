import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createQlooClient } from "./client";
import { createRunContext } from "./context";
import { QlooFixtureMissError } from "./errors";
import type { Endpoint } from "./constants";
import { encodeFixture, FixtureCache, findFixture, GZIP_ABOVE_BYTES, loadFixtures, readFixtureFile } from "./fixtures";
import { cacheKey } from "./params";
import { searchEntities } from "./search";
import { ifRecorded, itRecorded } from "../testing/recorded";

const smoke = ifRecorded(() => readFixtureFile(findFixture("smoke") as string));

function replayClient() {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    throw new Error("replay must never reach the network");
  });
  const client = createQlooClient({ cache: new FixtureCache(loadFixtures(), { strict: true }), fetch: fetchMock });
  return { client, fetchMock };
}

describe("FixtureCache (QLOO_MODE=fixtures)", () => {
  itRecorded("replays a recorded request with no key and no network, as recorded evidence", async () => {
    const { client, fetchMock } = replayClient();
    const ctx = createRunContext({ runId: "replay" });
    const { data, evidence } = await searchEntities(client, ctx, { query: "Olipop", types: ["urn:entity:brand"], take: 3 });
    expect(data[0].name).toBe("Olipop");
    expect(evidence).toMatchObject({ cached: true, status: 200, fetchedAt: smoke.recordedAt });
    expect(ctx.liveCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a request that was never recorded, before any call", async () => {
    const { client, fetchMock } = replayClient();
    const ctx = createRunContext({ runId: "replay" });
    await expect(searchEntities(client, ctx, { query: "Not recorded", types: ["urn:entity:brand"] })).rejects.toBeInstanceOf(
      QlooFixtureMissError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.liveCalls).toBe(0);
  });

  it("names the missing request in the error", async () => {
    const { client } = replayClient();
    await expect(
      searchEntities(client, createRunContext({ runId: "replay" }), { query: "Not recorded", types: ["urn:entity:brand"] }),
    ).rejects.toThrow(/\/search\?query=Not%20recorded/);
  });

  itRecorded("leaves out probe fixtures, whose params the app could never send", async () => {
    const all = loadFixtures();
    const probe = all.find((f) => f.name === "probe-extra");
    expect(probe?.probe).toBe(true);
    const request = probe?.requests.find((r) => r.id === "ignored-brand-filter-location");
    expect(request?.status).toBe(200);
    const cache = new FixtureCache(all);
    expect(await cache.get(cacheKey(request?.endpoint as Endpoint, request?.params ?? {}))).toBeUndefined();
  });

  itRecorded("is read-only", async () => {
    const cache = new FixtureCache([smoke]);
    const before = cache.size;
    await cache.set();
    expect(cache.size).toBe(before);
  });
});

describe("fixture files", () => {
  it("stays readable JSON when small and gzips when large", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stoop-fixtures-"));
    const small = encodeFixture("small", { requests: [] }, dir);
    expect(small.file.endsWith("small.json")).toBe(true);
    const large = encodeFixture("large", { blob: "x".repeat(GZIP_ABOVE_BYTES) }, dir);
    expect(large.file.endsWith("large.json.gz")).toBe(true);
    expect(large.text.length).toBeGreaterThan(GZIP_ABOVE_BYTES);
  });

  itRecorded("reads gzipped fixtures", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stoop-fixtures-"));
    writeFileSync(path.join(dir, "zipped.json.gz"), gzipSync(JSON.stringify(smoke)));
    expect(findFixture("zipped", dir)).toBe(path.join(dir, "zipped.json.gz"));
    expect(readFixtureFile(path.join(dir, "zipped.json.gz"))).toEqual(smoke);
  });
});
