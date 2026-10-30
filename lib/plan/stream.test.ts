// The live plan stream on a fake clock: it polls fast while the plan runs, slowly once it ended, stays
// for marketing that is under way, and closes a finished plan at once.
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { createPlanEmitter, type PlanEventInput } from "./events";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { appendPlanEvents, setPlanMeta, type PlanMeta } from "./store";
import { streamLivePlan } from "./stream";

const RUN_ID = "plan_0123456789abcdef01234567";
const T0 = Date.parse("2026-10-29T12:00:00Z");

function clock(start = T0) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => (now += ms),
    sleeps,
    sleep: (hooks: ((at: number) => Promise<void> | void)[] = []) => async (ms: number) => {
      sleeps.push(ms);
      now += ms;
      for (const hook of hooks) await hook(now);
    },
  };
}

async function seed(store: MemoryStore, status: PlanMeta["status"], updatedAt: number, inputs: PlanEventInput[], atMs = updatedAt) {
  const emit = createPlanEmitter(() => new Date(atMs));
  await appendPlanEvents(store, RUN_ID, [emit({ type: "plan.started", runId: RUN_ID, kind: "live", inputs: PLAN_EXAMPLE_INPUTS["chicago-18th-street"] }), ...inputs.map(emit)]);
  await setPlanMeta(store, { runId: RUN_ID, status, inputHash: "0".repeat(64), createdAt: new Date(T0).toISOString(), updatedAt: new Date(updatedAt).toISOString() });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += new TextDecoder().decode(value);
  }
}

const marketingStarted: PlanEventInput = { type: "stage.started", stage: "marketing" };
const marketingDone: PlanEventInput = { type: "stage.done", stage: "marketing", stats: { durationMs: 1000, liveCalls: 0, cachedCalls: 0 } };

describe("the live plan stream", () => {
  it("closes a plan that ended long ago at once, and frees its lease", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "done", T0 - 10 * 60_000, [{ type: "run.done" }]);
    let closed = 0;
    const text = await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep(), onClose: () => void closed++ }));
    expect(text).toContain('"type":"run.done"');
    expect(text).toContain('"status":"done"');
    expect(c.sleeps).toEqual([]);
    expect(closed).toBe(1);
  });

  it("closes as soon as marketing is done", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "done", T0, [{ type: "run.done" }, marketingStarted, marketingDone]);
    await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep() }));
    expect(c.sleeps).toEqual([]);
  });

  it("waits a little after the end for marketing to start, polling slowly, then closes", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "done", T0, [{ type: "run.done" }]);
    await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep(), lingerMs: 15_000, idlePollMs: 2_000 }));
    expect(c.sleeps.every((ms) => ms === 2_000)).toBe(true);
    expect(c.sleeps.length).toBe(8);
  });

  it("stays while marketing writes, and closes when it is done", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "done", T0, [{ type: "run.done" }, marketingStarted]);
    let written = false;
    const hook = async (at: number) => {
      if (!written && at - T0 >= 40_000) {
        written = true;
        await appendPlanEvents(store, RUN_ID, [createPlanEmitter(() => new Date(at))(marketingDone)]);
      }
    };
    const text = await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep([hook]), lingerMs: 15_000, idlePollMs: 2_000 }));
    expect(text).toContain('"stage":"marketing"');
    expect(c.now() - T0).toBe(40_000);
  });

  it("gives up on marketing that went quiet", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "done", T0 - 5 * 60_000, [{ type: "run.done" }, marketingStarted], T0 - 5 * 60_000);
    await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep(), marketingQuietMs: 90_000 }));
    expect(c.sleeps).toEqual([]);
  });

  it("polls fast while the plan runs", async () => {
    const store = new MemoryStore();
    const c = clock();
    await seed(store, "running", T0, [], T0 - 60_000);
    let n = 0;
    const finish = async () => {
      if (++n === 3) await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0 - 60_000).toISOString() });
    };
    await drain(streamLivePlan(store, RUN_ID, { now: c.now, sleep: c.sleep([finish]), pollMs: 700 }));
    expect(c.sleeps).toEqual([700, 700, 700]);
  });
});
