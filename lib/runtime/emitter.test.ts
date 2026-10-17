import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { readRunEvents, setRunMeta } from "../store/runs";
import type { Store } from "../store/types";
import { RETRY_WAITS_MS, storeEmitter } from "./emitter";

const runId = `run_${"9".repeat(24)}`;
const at = "2026-10-17T12:00:00.000Z";
const step = (label: string) => ({ type: "trace.step" as const, step: { stage: "prove" as const, kind: "decision" as const, label } });

async function withRun() {
  const store = new MemoryStore();
  await setRunMeta(store, { runId, attempt: 1, status: "running", briefHash: "a".repeat(64), createdAt: at, updatedAt: at });
  return store;
}

/** A store whose list writes fail the first `times` times. */
const flaky = (store: MemoryStore, times: number): Store => {
  let left = times;
  return Object.assign(Object.create(store), {
    append: async (...args: Parameters<Store["append"]>) => {
      if (left-- > 0) throw new Error("store write failed");
      return store.append(...args);
    },
  });
};

describe("the live run's emitter", () => {
  it("writes events in batches with the store's seqs, in the order they were emitted", async () => {
    const store = await withRun();
    const emitter = storeEmitter(store, runId, 1);
    for (let i = 0; i < 5; i++) emitter.emit(step(`step ${i}`));
    await emitter.flush();
    emitter.emit(step("step 5"));
    await emitter.flush();
    const written = await readRunEvents(store, runId, 1);
    expect(written.map((e) => [e.seq, e.type === "trace.step" ? e.step.label : null])).toEqual([0, 1, 2, 3, 4, 5].map((i) => [i, `step ${i}`]));
    expect(emitter.events).toEqual(written);
  });

  it("refuses a bad event at once, like the recording emitter", async () => {
    const emitter = storeEmitter(await withRun(), runId, 1);
    expect(() => emitter.emit({ type: "world.started", segmentId: "Not A Slug", label: "x" })).toThrow();
  });

  it("tries a failed write again, and keeps the events", async () => {
    const memory = await withRun();
    const waits: number[] = [];
    const emitter = storeEmitter(flaky(memory, 1), runId, 1, { sleep: async (ms) => void waits.push(ms) });
    emitter.emit(step("kept"));
    await emitter.flush();
    expect(waits).toEqual([RETRY_WAITS_MS[0]]);
    expect(await readRunEvents(memory, runId, 1)).toHaveLength(1);
  });

  it("calls for the run to stop when the store stays down, once, and its flush rejects", async () => {
    const memory = await withRun();
    let stops = 0;
    const emitter = storeEmitter(flaky(memory, 99), runId, 1, { sleep: async () => undefined, onFailure: () => void stops++ });
    emitter.emit(step("lost"));
    await expect(emitter.flush()).rejects.toThrow(/store write failed/);
    emitter.emit(step("after"));
    await expect(emitter.flush()).rejects.toThrow();
    expect(stops).toBe(1);
  });
});
