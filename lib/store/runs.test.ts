import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reduce, type RunEvent } from "../events";
import { sha256 } from "../hash";
import { DAY_SECONDS, keys } from "./keys";
import { MemoryStore } from "./memory";
import { appendRunEvents, getRunMeta, indexAfter, loadReport, readRunEvents, refreshReport, setRunMeta, type RunMeta } from "./runs";
import type { Store } from "./types";
import { clientIp, saltedHash, visitorId } from "./visitor";
import { describeRecorded, ifRecorded } from "../testing/recorded";

// A real recorded full run, written into a store as the runtime would write it.
const full = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as RunEvent[]);
const runId = `run_${"c".repeat(24)}`;
const meta: RunMeta = { runId, attempt: 1, status: "done", briefHash: "d".repeat(64), createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:01:00.000Z" };
const [segA, segB] = ifRecorded(() => reduce(full).worlds.map((w) => w.segmentId)) ?? [];
const frames = { revisionId: null, status: "paused" as const, reason: "Storyboards paused today.", frames: [], critiques: [] };

async function storedRun(store: Store = new MemoryStore(), status: RunMeta["status"] = "done") {
  await setRunMeta(store, { ...meta, status });
  const events = full.map((e) => (e.type === "run.started" ? { ...e, runId } : e));
  await store.append(keys.run.events(runId, 1), events, { ttlSeconds: 7 * DAY_SECONDS });
  await store.incr(keys.run.seq(runId, 1), { by: events.length, ttlSeconds: 7 * DAY_SECONDS });
  return store;
}

describeRecorded("the run log", () => {
  it("gives concurrent writers distinct seqs after the run's own, and the report picks them up", async () => {
    const store = await storedRun();
    const [a, b] = await Promise.all([
      appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segA, frames }]),
      appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segB, frames }]),
    ]);
    expect([a[0].seq, b[0].seq].sort((x, y) => x - y)).toEqual([full.length, full.length + 1]);
    expect(a[0].attempt).toBe(1);
    const report = await refreshReport(store, runId);
    expect(report?.worlds.map((w) => w.frames?.status)).toEqual(["paused", "paused"]);
    expect(await loadReport(store, runId)).toEqual(report);
  });

  it("checks every event before taking a seq, so a refused write leaves no gap", async () => {
    const store = await storedRun();
    await expect(appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segA, frames }, { type: "world.frames", segmentId: "Not A Slug", frames } as never])).rejects.toThrow();
    expect(await store.get(keys.run.seq(runId, 1))).toBe(full.length);
    expect(await appendRunEvents(store, runId, 1, [])).toEqual([]);
  });

  it("keeps the run's list, counter and meta alive together, so a late write never reuses seq 0", async () => {
    let now = Date.parse("2026-10-30T22:00:00.000Z");
    const store = await storedRun(new MemoryStore({ now: () => now }));
    now += 6 * DAY_SECONDS * 1000;
    await appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segA, frames }]);
    now += 2 * DAY_SECONDS * 1000;
    const [late] = await appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segB, frames }]);
    expect(late.seq).toBe(full.length + 1);
    expect(await getRunMeta(store, runId)).not.toBeNull();
    expect((await refreshReport(store, runId))?.worlds.map((w) => w.frames?.status)).toEqual(["paused", "paused"]);
  });

  it("leaves the stored report alone while the run is still going", async () => {
    const store = await storedRun(new MemoryStore(), "running");
    expect(await refreshReport(store, runId)).toBeNull();
    expect(await loadReport(store, runId)).toBeNull();
  });

  it("saves the longer list when another writer appends while a report is being saved", async () => {
    const store = await storedRun();
    // Another writer lands right after this refresh read the list, once.
    let raced = false;
    const racing: Store = Object.assign(Object.create(store), {
      length: async (key: string) => {
        if (!raced) {
          raced = true;
          await appendRunEvents(store, runId, 1, [{ type: "world.frames", segmentId: segB, frames }]);
        }
        return store.length(key);
      },
    });
    const report = await refreshReport(racing, runId);
    expect(report?.worlds.find((w) => w.segmentId === segB)?.frames?.status).toBe("paused");
    expect((await loadReport(store, runId))?.worlds.find((w) => w.segmentId === segB)?.frames).not.toBeNull();
  });

  it("resumes a stream after the last event seen, by seq rather than position", async () => {
    const store = await storedRun();
    const events = await readRunEvents(store, runId, 1);
    expect(indexAfter(events, events[10].seq)).toBe(11);
    expect(indexAfter([{ seq: 0 }, { seq: 2 }, { seq: 1 }], 2)).toBe(2);
    expect(indexAfter(events, 9_999)).toBe(0);
    expect(await readRunEvents(store, runId, 1, indexAfter(events, events.at(-1)!.seq))).toEqual([]);
  });

  it("checks run meta on the way in and out", async () => {
    const store = new MemoryStore();
    await expect(setRunMeta(store, { ...meta, status: "queued" as never })).rejects.toThrow();
    await setRunMeta(store, meta);
    expect(await getRunMeta(store, runId)).toEqual(meta);
    expect(await getRunMeta(store, `run_${"e".repeat(24)}`)).toBeNull();
    await expect(refreshReport(store, `run_${"e".repeat(24)}`)).rejects.toThrow(/does not exist/);
  });
});

describe("visitors", () => {
  it("reads the first forwarded IP, and hashes it with one salt so the id is stable but not the IP's plain hash", async () => {
    const store = new MemoryStore();
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBeNull();
    const id = await visitorId(store, headers);
    expect(id).toMatch(/^v_[0-9a-f]{24}$/);
    for (const plain of ["203.0.113.7", "ip:203.0.113.7"]) expect(id.slice(2)).not.toBe(sha256(plain).slice(0, 24));
    expect(await visitorId(store, headers)).toBe(id);
    expect(await visitorId(store, new Headers({ "x-forwarded-for": "203.0.113.8" }))).not.toBe(id);
    // Another store (another salt) gives the same IP another id.
    expect(await visitorId(new MemoryStore(), headers)).not.toBe(id);
  });

  it("hashes emails with the same salt, apart from visitor ids", async () => {
    const store = new MemoryStore();
    const hash = await saltedHash(store, "founder@example.com");
    expect(hash).toMatch(/^h_[0-9a-f]{32}$/);
    expect(await saltedHash(store, "founder@example.com")).toBe(hash);
    expect(hash.slice(2)).not.toBe(sha256("founder@example.com").slice(0, 32));
  });
});
