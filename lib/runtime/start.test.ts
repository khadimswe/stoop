import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { getRunMeta, setRunMeta } from "../store/runs";
import type { VisitorId } from "../store/visitor";
import { ApiFailure } from "./errors";
import { loadRunRecord, saveIntake } from "./record";
import { MAX_LIVE_RUNS, RUNS_PER_HOUR, resumeRun, startRun, type StartDeps } from "./start";
import type { RequestContext } from "./types";

// A real stored run's inputs and receipts stand in for an intake.
const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
const intakeId = `in_${"1".repeat(24)}`;
const seedIds = report.inputs.seeds.map((s) => s.ref.id);
const LIVE = { STOOP_LIVE: "true" };

async function setup(env: Record<string, string> = LIVE) {
  const store = new MemoryStore();
  const seedReceipts = new Set(report.inputs.seeds.flatMap((s) => s.evidenceIds));
  await saveIntake(store, {
    intakeId,
    createdAt: "2026-10-17T12:00:00.000Z",
    product: report.inputs.product,
    region: report.inputs.region,
    statedCustomer: report.inputs.statedCustomer,
    site: null,
    stated: null,
    seeds: report.inputs.seeds,
    evidence: report.ledger.filter((e) => seedReceipts.has(e.id)),
  });
  let n = 0;
  const scheduled: string[] = [];
  const deps: StartDeps = { env, randomHex: () => (++n).toString(16).padStart(24, "0"), schedule: () => undefined, execute: async (id) => void scheduled.push(id) };
  deps.schedule = (task) => void task();
  const ctx = (visitor = "v_aaaaaaaaaaaaaaaaaaaaaaaa"): RequestContext => ({ store, visitor: visitor as VisitorId, source: "web" });
  const start = (overrides: Record<string, unknown> = {}, visitor?: string) =>
    startRun(deps, { intakeId, seedIds, statedCustomer: report.inputs.statedCustomer, region: report.inputs.region, direction: report.inputs.direction, ...overrides }, ctx(visitor));
  return { store, deps, ctx, start, scheduled };
}

describe("starting a live run", () => {
  it("replays an example while STOOP_LIVE is off, without touching the store", async () => {
    const { start, store } = await setup({});
    expect(await start()).toMatchObject({ mode: "example", slug: "food-hot-sauce", reason: "replay" });
    expect(await store.get(keys.daily("live-runs"))).toBeNull();
  });

  it("starts a run from the intake's seeds, with their receipts, and schedules it", async () => {
    const { start, store, scheduled } = await setup();
    const reply = await start();
    expect(reply).toMatchObject({ mode: "live", joined: false });
    if (reply.mode !== "live") throw new Error("not live");
    expect(reply.eventsUrl).toBe(`/api/run/${reply.runId}/events`);
    expect(scheduled).toEqual([reply.runId]);
    expect(await getRunMeta(store, reply.runId)).toMatchObject({ attempt: 1, status: "running" });
    const record = await loadRunRecord(store, reply.runId);
    expect(record?.inputs.seeds.map((s) => s.ref.id)).toEqual(seedIds);
    expect(record?.seedEvidence.map((e) => e.id).sort()).toEqual([...new Set(report.inputs.seeds.flatMap((s) => s.evidenceIds))].sort());
  });

  it("joins the run already going for the same brief, in any seed order", async () => {
    const { start, scheduled } = await setup();
    const first = await start();
    const again = await start({ seedIds: [...seedIds].reverse() });
    expect(again).toMatchObject({ mode: "live", joined: true, runId: first.mode === "live" ? first.runId : "" });
    expect(scheduled).toHaveLength(1);
  });

  it("refuses seeds the intake never offered, and notes that break the guardrails", async () => {
    const { start } = await setup();
    await expect(start({ seedIds: [seedIds[0], "not-a-seed"] })).rejects.toBeInstanceOf(ApiFailure);
    await expect(start({ direction: { notes: "Cast a teenager in a high school hallway." } })).rejects.toThrow(/notes/);
  });

  it("admits two live runs at once; the third gets an example and gives its daily slot back", async () => {
    const { start, store } = await setup();
    const runs = [];
    for (let i = 0; i < MAX_LIVE_RUNS; i++) runs.push(await start({ region: `Region ${i}` }, `v_${String(i).repeat(24)}`));
    expect(runs.every((r) => r.mode === "live")).toBe(true);
    expect(await start({ region: "Region x" }, "v_bbbbbbbbbbbbbbbbbbbbbbbb")).toMatchObject({ mode: "example", reason: "busy" });
    expect(await store.get(keys.daily("live-runs"))).toBe(MAX_LIVE_RUNS);
  });

  it("caps runs per visitor per hour and per day", async () => {
    const { start, store } = await setup();
    for (let i = 0; i < RUNS_PER_HOUR; i++) await store.incr(keys.rate("run", "v_cccccccccccccccccccccccc" as VisitorId, new Date().toISOString().slice(0, 13)));
    expect(await start({}, "v_cccccccccccccccccccccccc")).toMatchObject({ mode: "example", reason: "rate-limited" });
    const capped = await setup({ ...LIVE, LIVE_RUNS_DAILY_CAP: "0" });
    expect(await capped.start()).toMatchObject({ mode: "example", reason: "daily-cap" });
  });

  it("does not join a failed run: the same brief starts fresh", async () => {
    const { start, store } = await setup();
    const first = await start();
    if (first.mode !== "live") throw new Error("not live");
    const meta = (await getRunMeta(store, first.runId))!;
    await setRunMeta(store, { ...meta, status: "failed" });
    await store.leaseRelease(keys.liveLeases, first.runId);
    await store.del(keys.brief(meta.briefHash));
    const second = await start();
    expect(second).toMatchObject({ mode: "live", joined: false });
  });
});

describe("resuming a run", () => {
  it("resumes a stopped run under the next attempt, and joins a finished one", async () => {
    const { start, store, deps, ctx, scheduled } = await setup();
    const first = await start();
    if (first.mode !== "live") throw new Error("not live");
    const meta = (await getRunMeta(store, first.runId))!;
    await setRunMeta(store, { ...meta, status: "stopped" });
    await store.leaseRelease(keys.liveLeases, first.runId);
    expect(await resumeRun(deps, first.runId, ctx())).toMatchObject({ mode: "live", joined: false });
    expect(await getRunMeta(store, first.runId)).toMatchObject({ attempt: 2, status: "running" });
    expect(scheduled).toEqual([first.runId, first.runId]);
    // Still running, with its lease: resuming again just joins it.
    expect(await resumeRun(deps, first.runId, ctx())).toMatchObject({ joined: true });
    await setRunMeta(store, { ...(await getRunMeta(store, first.runId))!, status: "done" });
    expect(await resumeRun(deps, first.runId, ctx())).toMatchObject({ joined: true });
    expect(scheduled).toHaveLength(2);
  });

  it("restarts a run whose instance died (running, lease gone), and says busy when no slot is free", async () => {
    const { start, store, deps, ctx } = await setup();
    const first = await start();
    if (first.mode !== "live") throw new Error("not live");
    await store.leaseRelease(keys.liveLeases, first.runId);
    for (let i = 0; i < MAX_LIVE_RUNS; i++) await store.leaseAcquire(keys.liveLeases, `other-${i}`, { max: MAX_LIVE_RUNS, ttlMs: 60_000 });
    await expect(resumeRun(deps, first.runId, ctx())).rejects.toThrow(/Two live runs/);
    await store.leaseRelease(keys.liveLeases, "other-0");
    expect(await resumeRun(deps, first.runId, ctx())).toMatchObject({ joined: false });
    expect(await getRunMeta(store, first.runId)).toMatchObject({ attempt: 2 });
  });
});
