import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../report/schema";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { getRunMeta, liveStatus, runLease, setRunMeta } from "../store/runs";
import type { Store } from "../store/types";
import { tokenVisitorId, type CookieVisitorId, type VisitorId } from "../store/visitor";
import { ApiFailure } from "./errors";
import { loadRunRecord, saveIntake } from "./record";
import { MAX_LIVE_RUNS, RUNS_PER_HOUR, resumeRun, startRun, type StartDeps } from "./start";
import type { RequestContext } from "./types";

// A real stored run's inputs and receipts stand in for an intake.
const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
const intakeId = `in_${"1".repeat(24)}`;
const seedIds = report.inputs.seeds.map((s) => s.ref.id);
const LIVE = { STOOP_LIVE: "true" };

async function setup(env: Record<string, string> = LIVE, wrap: (store: MemoryStore) => Store = (s) => s) {
  const memory = new MemoryStore();
  const seedReceipts = new Set(report.inputs.seeds.flatMap((s) => s.evidenceIds));
  await saveIntake(memory, {
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
  const store = wrap(memory);
  let n = 0;
  const scheduled: string[] = [];
  const deps: StartDeps = { env, randomHex: () => (++n).toString(16).padStart(24, "0"), schedule: (task) => void task(), execute: async (id) => void scheduled.push(id) };
  const ctx = (visitor = "v_aaaaaaaaaaaaaaaaaaaaaaaa"): RequestContext => ({ store, visitor: visitor as VisitorId, source: "web" });
  const start = (overrides: Record<string, unknown> = {}, visitor?: string) =>
    startRun(deps, { intakeId, seedIds, statedCustomer: report.inputs.statedCustomer, region: report.inputs.region, direction: report.inputs.direction, ...overrides }, ctx(visitor));
  return { store: memory, deps, ctx, start, scheduled };
}

const liveId = (reply: Awaited<ReturnType<typeof startRun>>) => {
  if (reply.mode !== "live") throw new Error(`expected a live run, got ${reply.reason}`);
  return reply.runId;
};

describe("starting a live run", () => {
  it("replays an example while STOOP_LIVE is off, without touching the store", async () => {
    const { start, store } = await setup({});
    expect(await start()).toMatchObject({ mode: "example", slug: "food-hot-sauce", reason: "replay" });
    expect(await store.get(keys.daily("live-runs"))).toBeNull();
  });

  it("starts a run from the intake's seeds, with their receipts, its lease and its schedule", async () => {
    const { start, store, scheduled } = await setup();
    const runId = liveId(await start());
    expect(scheduled).toEqual([runId]);
    expect(await getRunMeta(store, runId)).toMatchObject({ attempt: 1, status: "running" });
    expect(await store.leaseHeld(keys.liveLeases, runLease(runId, 1))).toBe(true);
    const record = await loadRunRecord(store, runId);
    expect(record?.inputs.seeds.map((s) => s.ref.id)).toEqual(seedIds);
    expect(record?.seedEvidence.map((e) => e.id).sort()).toEqual([...new Set(report.inputs.seeds.flatMap((s) => s.evidenceIds))].sort());
  });

  it("keeps who started the run in its meta, by salted ids only, so its storyboards count against them", async () => {
    const { deps, ctx, store } = await setup();
    const cookie = "c_cccccccccccccccccccccccc" as CookieVisitorId;
    const withCookie = liveId(await startRun(deps, { intakeId, seedIds, statedCustomer: null, region: "Texas", direction: report.inputs.direction }, { ...ctx(), cookieVisitor: cookie }));
    expect(await getRunMeta(store, withCookie)).toMatchObject({ visitor: "v_aaaaaaaaaaaaaaaaaaaaaaaa", cookieVisitor: cookie });
    // A culture_brief run is started as its MCP token (t_), never as the connector's shared IP.
    const token = tokenVisitorId("d".repeat(64));
    const agent = liveId(await startRun(deps, { intakeId, seedIds, statedCustomer: null, region: "Ohio", direction: report.inputs.direction }, { store, visitor: token, cookieVisitor: null, source: "mcp" }));
    expect(await getRunMeta(store, agent)).toMatchObject({ visitor: token, cookieVisitor: null });
    expect(token).toBe(`t_${"d".repeat(24)}`);
  });

  it("passes on when its invocation began when earlier work shared it (MCP intake), so the run's deadline counts from there", async () => {
    const { deps, ctx } = await setup();
    const seen: unknown[] = [];
    deps.execute = async (_id, options) => void seen.push(options);
    await startRun(deps, { intakeId, seedIds, statedCustomer: report.inputs.statedCustomer, region: report.inputs.region, direction: report.inputs.direction }, { ...ctx(), startedAt: 1_000 });
    await startRun(deps, { intakeId, seedIds, statedCustomer: null, region: "Texas", direction: report.inputs.direction }, ctx("v_dddddddddddddddddddddddd"));
    expect(seen).toEqual([{ startedAt: 1_000 }, {}]);
  });

  it("joins the run already going for the same brief, in any seed order", async () => {
    const { start, scheduled } = await setup();
    const first = liveId(await start());
    expect(await start({ seedIds: [...seedIds].reverse() })).toMatchObject({ mode: "live", joined: true, runId: first });
    expect(scheduled).toHaveLength(1);
  });

  it("refuses seeds the intake never offered", async () => {
    const { start } = await setup();
    await expect(start({ seedIds: [seedIds[0], "not-a-seed"] })).rejects.toBeInstanceOf(ApiFailure);
  });

  it("holds the founder's text to the guardrails: notes that name a seed or a minor, a customer described by ethnicity", async () => {
    const { start, store } = await setup();
    const seedName = report.inputs.seeds[0].ref.name;
    await expect(start({ direction: { notes: `Make it feel like ${seedName}.` } })).rejects.toThrow(/notes/);
    await expect(start({ direction: { notes: "Cast a teenager in a high school hallway." } })).rejects.toThrow(/notes/);
    await expect(start({ statedCustomer: "Hispanic moms in Texas, 30 to 45" })).rejects.toThrow(/Describe your customer/);
    expect(await store.get(keys.daily("live-runs"))).toBeNull();
  });

  it("admits two live runs at once; the third gets an example and gives its daily slot back", async () => {
    const { start, store } = await setup();
    for (let i = 0; i < MAX_LIVE_RUNS; i++) liveId(await start({ region: `Region ${i}` }, `v_${String(i).repeat(24)}`));
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

  it("starts a failed run's brief fresh: its old claim is replaced", async () => {
    const { start, store } = await setup();
    const first = liveId(await start());
    const meta = (await getRunMeta(store, first))!;
    await setRunMeta(store, { ...meta, status: "failed" });
    await store.leaseRelease(keys.liveLeases, runLease(first, 1));
    const second = liveId(await start());
    expect(second).not.toBe(first);
    expect(await store.get(keys.brief(meta.briefHash))).toMatchObject({ runId: second });
  });

  it("runs a brief once when Start is pressed twice, wherever the second press lands in the first start", async () => {
    // Every store call takes a few ms, as over the network, so the second press can land mid-start.
    const slow = (memory: MemoryStore): Store =>
      new Proxy(memory, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return async (...args: unknown[]) => {
            await new Promise((resolve) => setTimeout(resolve, 3));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    for (const offset of [0, 10, 20, 30, 45, 60, 90]) {
      const { start, scheduled } = await setup(LIVE, slow);
      const first = start();
      await new Promise((resolve) => setTimeout(resolve, offset));
      const [a, b] = await Promise.all([first, start()]);
      expect(liveId(a), `second press at ${offset} ms`).toBe(liveId(b));
      expect(scheduled, `second press at ${offset} ms`).toHaveLength(1);
    }
  });

  it("waits for a start still writing its run, says busy if it never lands, and replaces a claim left by a crash", async () => {
    let now = Date.parse("2026-10-17T12:00:00.000Z");
    const { start, store, deps, scheduled } = await setup();
    deps.now = () => now;
    deps.sleep = async () => undefined;
    const first = liveId(await start());
    const meta = (await getRunMeta(store, first))!;
    // A start that claimed the brief but has not written its run yet (or crashed doing so).
    await store.del(keys.run.meta(first));
    await store.leaseRelease(keys.liveLeases, runLease(first, 1));
    expect(await start()).toMatchObject({ mode: "example", reason: "busy" });
    now += 31_000;
    const fresh = liveId(await start());
    expect(fresh).not.toBe(first);
    expect(await store.get(keys.brief(meta.briefHash))).toMatchObject({ runId: fresh });
    expect(scheduled).toEqual([first, fresh]);
  });

  it("gives back the lease, the day's count and the claim when a start fails halfway", async () => {
    let failing = true;
    const { start, store } = await setup(LIVE, (memory) =>
      Object.assign(Object.create(memory), {
        set: async (key: string, value: unknown, options?: object) => {
          if (failing && key.endsWith(":input")) throw new Error("store write failed");
          return memory.set(key, value, options);
        },
      }),
    );
    await expect(start()).rejects.toThrow(/store write failed/);
    expect(await store.leaseCount(keys.liveLeases)).toBe(0);
    expect(await store.get(keys.daily("live-runs"))).toBe(0);
    failing = false;
    expect((await start()).mode).toBe("live");
  });
});

describe("resuming a run", () => {
  it("resumes a stopped run under the next attempt, and joins one still running or finished", async () => {
    const { start, store, deps, ctx, scheduled } = await setup();
    const runId = liveId(await start());
    const meta = (await getRunMeta(store, runId))!;
    await setRunMeta(store, { ...meta, status: "stopped" });
    await store.leaseRelease(keys.liveLeases, runLease(runId, 1));
    expect(await resumeRun(deps, runId, ctx())).toMatchObject({ mode: "live", joined: false });
    expect(await getRunMeta(store, runId)).toMatchObject({ attempt: 2, status: "running" });
    expect(await store.leaseHeld(keys.liveLeases, runLease(runId, 2))).toBe(true);
    expect(scheduled).toEqual([runId, runId]);
    expect(await resumeRun(deps, runId, ctx())).toMatchObject({ joined: true });
    await setRunMeta(store, { ...(await getRunMeta(store, runId))!, status: "done" });
    expect(await resumeRun(deps, runId, ctx())).toMatchObject({ joined: true });
    expect(scheduled).toHaveLength(2);
  });

  it("shows a run whose instance died as stopped, and checking never keeps its lease alive", async () => {
    let now = Date.parse("2026-10-17T12:00:00.000Z");
    const { start, store, deps, ctx } = await setup();
    deps.now = () => now;
    const runId = liveId(await start());
    const meta = (await getRunMeta(store, runId))!;
    expect(await liveStatus(store, meta, now)).toBe("running");
    // Past the lease, with no instance refreshing it: the run is stopped.
    now += 400_000;
    expect(await liveStatus(store, meta, now)).toBe("stopped");
    expect(await resumeRun(deps, runId, ctx())).toMatchObject({ joined: false });
    expect(await getRunMeta(store, runId)).toMatchObject({ attempt: 2 });
  });

  it("runs an attempt once when Resume is pressed twice at the same moment", async () => {
    const { start, store, deps, ctx, scheduled } = await setup();
    const runId = liveId(await start());
    await setRunMeta(store, { ...(await getRunMeta(store, runId))!, status: "stopped" });
    await store.leaseRelease(keys.liveLeases, runLease(runId, 1));
    const replies = await Promise.all([resumeRun(deps, runId, ctx()), resumeRun(deps, runId, ctx())]);
    expect(replies.filter((r) => r.mode === "live" && !r.joined)).toHaveLength(1);
    expect(scheduled.filter((id) => id === runId)).toHaveLength(2);
    expect(await store.leaseCount(keys.liveLeases)).toBe(1);
  });

  it("says busy when no slot is free, and lets the next press claim the attempt", async () => {
    const { start, store, deps, ctx } = await setup();
    const runId = liveId(await start());
    await setRunMeta(store, { ...(await getRunMeta(store, runId))!, status: "stopped" });
    await store.leaseRelease(keys.liveLeases, runLease(runId, 1));
    for (let i = 0; i < MAX_LIVE_RUNS; i++) await store.leaseAcquire(keys.liveLeases, `other-${i}`, { max: MAX_LIVE_RUNS, ttlMs: 60_000 });
    await expect(resumeRun(deps, runId, ctx())).rejects.toThrow(/Two live runs/);
    await store.leaseRelease(keys.liveLeases, "other-0");
    expect(await resumeRun(deps, runId, ctx())).toMatchObject({ joined: false });
  });
});
