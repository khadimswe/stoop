import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../events";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { appendRunEvents, runLease, setRunMeta, type RunMeta } from "../store/runs";
import { streamExample, streamLiveRun } from "./stream";

const recorded = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as RunEvent[];
const runId = `run_${"d".repeat(24)}`;
const at = "2026-10-17T12:00:00.000Z";
const meta: RunMeta = { runId, attempt: 1, status: "running", briefHash: "e".repeat(64), createdAt: at, updatedAt: at };
/** Events as a writer sends them: the store stamps seq, time and attempt. */
/** A run some instance is still on: its attempt's lease is held. */
const hold = (store: MemoryStore, attempt = 1) => store.leaseAcquire(keys.liveLeases, runLease(runId, attempt), { max: 2, ttlMs: 600_000 });

const inputsOf = (events: readonly RunEvent[]) =>
  events.map((event) => {
    const input: Record<string, unknown> = { ...event };
    for (const stamped of ["seq", "at", "attempt"]) delete input[stamped];
    return input;
  }) as never[];

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

async function frames(stream: ReadableStream<Uint8Array>): Promise<Frame[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const frame: Frame = {};
      for (const line of block.split("\n")) {
        const [field, ...rest] = line.split(": ");
        if (field === "id" || field === "event" || field === "data") frame[field] = rest.join(": ");
      }
      return frame;
    })
    .filter((f) => f.event);
}

/** A clock that moves only when the stream sleeps, and a hook to change the store between polls. */
function clock(onSleep: (polls: number) => Promise<void> | void = () => undefined) {
  let now = 0;
  let polls = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
      await onSleep(++polls);
    },
  };
}

describe("the live run stream", () => {
  it("sends the attempt's events with attempt:seq ids, its status, and ends a while after the run is done", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, meta);
    await hold(store);
    await appendRunEvents(store, runId, 1, inputsOf(recorded.slice(0, 20)));
    const time = clock(async (polls) => {
      if (polls === 1) await appendRunEvents(store, runId, 1, inputsOf(recorded.slice(20)));
      if (polls === 2) await setRunMeta(store, { ...meta, status: "done" });
    });
    const out = await frames(streamLiveRun(store, runId, { ...time, lingerMs: 3_000 }));
    const runs = out.filter((f) => f.event === "run");
    expect(runs).toHaveLength(recorded.length);
    expect(runs[0].id).toBe("1:0");
    expect(runs.at(-1)?.id).toBe(`1:${recorded.length - 1}`);
    expect(out.filter((f) => f.event === "status").map((f) => JSON.parse(f.data!).status)).toEqual(["running", "done"]);
    // The last frame is the done status, after every event.
    expect(out.at(-1)).toMatchObject({ event: "status" });
    expect(JSON.parse(out.at(-1)!.data!).status).toBe("done");
  });

  it("picks up after Last-Event-ID, and stops with a resumable status when the run stopped", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, { ...meta, status: "stopped" });
    await appendRunEvents(store, runId, 1, inputsOf(recorded.slice(0, 30)));
    const out = await frames(streamLiveRun(store, runId, { ...clock(), lastEventId: "1:9" }));
    const runs = out.filter((f) => f.event === "run");
    expect(runs[0].id).toBe("1:10");
    expect(runs).toHaveLength(20);
    expect(JSON.parse(out.find((f) => f.event === "status")!.data!)).toEqual({ status: "stopped", attempt: 1, resumable: true });
  });

  it("follows a resume to the next attempt from seq 0, even when the viewer last saw the old one", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, meta);
    await hold(store);
    await appendRunEvents(store, runId, 1, inputsOf(recorded.slice(0, 5)));
    const time = clock(async (polls) => {
      if (polls === 1) {
        await hold(store, 2);
        await setRunMeta(store, { ...meta, attempt: 2 });
        await appendRunEvents(store, runId, 2, inputsOf(recorded.slice(0, 3)));
      }
      if (polls === 2) await setRunMeta(store, { ...meta, attempt: 2, status: "done" });
    });
    const out = await frames(streamLiveRun(store, runId, { ...time, lastEventId: "1:4", lingerMs: 1_000 }));
    expect(out.filter((f) => f.event === "run").map((f) => f.id)).toEqual(["2:0", "2:1", "2:2"]);
    expect(out.filter((f) => f.event === "status").map((f) => JSON.parse(f.data!))).toEqual([
      { status: "running", attempt: 1, resumable: false },
      { status: "running", attempt: 2, resumable: false },
      { status: "done", attempt: 2, resumable: false },
    ]);
  });

  it("shows a run still marked running, whose lease is gone, as stopped and resumable", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, meta);
    await appendRunEvents(store, runId, 1, inputsOf(recorded.slice(0, 4)));
    const out = await frames(streamLiveRun(store, runId, clock()));
    expect(out.filter((f) => f.event === "run")).toHaveLength(4);
    expect(JSON.parse(out.at(-1)!.data!)).toEqual({ status: "stopped", attempt: 1, resumable: true });
  });

  it("ends with a failed status when the run is gone", async () => {
    const out = await frames(streamLiveRun(new MemoryStore(), runId, clock()));
    expect(out.map((f) => JSON.parse(f.data!).status)).toEqual(["failed"]);
  });

  it("stops polling when the viewer leaves", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, meta);
    await hold(store);
    const leave = new AbortController();
    const time = clock((polls) => (polls === 2 ? leave.abort() : undefined));
    await frames(streamLiveRun(store, runId, { ...time, signal: leave.signal }));
    expect(time.now()).toBe(2 * 750);
    expect(await store.length(keys.run.events(runId, 1))).toBe(0);
  });
});

describe("the example stream", () => {
  it("replays the recorded trace at a reading pace and ends done, from where the viewer left off", async () => {
    const paced: number[] = [];
    const out = await frames(streamExample(recorded, { sleep: async (ms) => void paced.push(ms), lastEventId: "1:99" }));
    const runs = out.filter((f) => f.event === "run");
    expect(runs[0].id).toBe("1:100");
    expect(runs).toHaveLength(recorded.length - 100);
    expect(paced.every((ms) => ms === 60)).toBe(true);
    expect(JSON.parse(out.at(-1)!.data!).status).toBe("done");
  });
});
