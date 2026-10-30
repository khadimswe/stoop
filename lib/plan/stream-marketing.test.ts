// A live plan's stream after the plan itself is done: it stays open while the poster and posts are being
// made (their job holds the marketing lock, even before its first event), so the page gets them without a
// reload, and its owner's reconnect is not told to stop (204) until that job is done. The clock starts at
// the plan's end, as the stream measures from it.
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { mintVisitorCookie, VISITOR_COOKIE } from "../visitor-cookie";
import { createPlanEmitter } from "./events";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { posterKeys } from "./marketing-keys";
import { getPlanEvents, type PlanRouteDeps } from "./routes";
import { appendPlanEvents, setPlanMeta } from "./store";
import { streamLivePlan } from "./stream";

const RUN_ID = "plan_0123456789abcdef0123abcd";
const SECRET = "s".repeat(40);
const owner = mintVisitorCookie(SECRET);
const ENDED = Date.parse("2026-10-29T12:00:00.000Z");
const inputs = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];

async function donePlan(store: MemoryStore) {
  const at = new Date(ENDED).toISOString();
  await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id });
  const emit = createPlanEmitter(() => new Date(ENDED));
  return appendPlanEvents(store, RUN_ID, [emit({ type: "plan.started", runId: RUN_ID, kind: "live", inputs }), emit({ type: "run.done" })]);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += new TextDecoder().decode(value);
  }
}

describe("a live plan's stream after the plan", () => {
  it("stays open while the marketing job holds the lock, and sends what it writes", async () => {
    const store = new MemoryStore();
    await donePlan(store);
    await store.set(posterKeys.lock(RUN_ID), "job");
    let t = ENDED;
    let written = false;
    const emit = createPlanEmitter(() => new Date(t));
    const sleep = async (ms: number) => {
      t += ms;
      // Well after the linger time, the job writes its posts and lets go of the lock.
      if (!written && t - ENDED >= 5_000) {
        written = true;
        await appendPlanEvents(store, RUN_ID, [emit({ type: "posts.ready", posts: { facebook: { text: "Hi" }, instagram: { caption: "Hi", hashtags: [] }, whatsapp: { text: "Hi" }, share: {} } })]);
        await store.del(posterKeys.lock(RUN_ID));
      }
    };
    const text = await readAll(streamLivePlan(store, RUN_ID, { pollMs: 500, lingerMs: 1_000, maxMs: 60_000, now: () => t, sleep }));
    expect(text).toContain('"type":"posts.ready"');
    // It ended a linger time after the lock went, not at the time limit.
    expect(t - ENDED).toBeLessThan(10_000);
  });

  it("ends after the linger time when no job is running", async () => {
    const store = new MemoryStore();
    await donePlan(store);
    let t = ENDED;
    await readAll(streamLivePlan(store, RUN_ID, { pollMs: 500, idlePollMs: 500, lingerMs: 1_000, maxMs: 60_000, now: () => t, sleep: async (ms) => void (t += ms) }));
    expect(t - ENDED).toBeLessThanOrEqual(1_500);
  });

  it("tells a viewer that has everything to stop, unless the poster and posts are still being made", async () => {
    const store = new MemoryStore();
    const events = await donePlan(store);
    const last = String(events.at(-1)!.seq);
    const deps = { env: { STOOP_SIGNING_SECRET: SECRET }, store: () => store, start: () => ({ execute: async () => {} }) } as PlanRouteDeps;
    const ask = () => getPlanEvents(new Request(`http://localhost/api/plan/${RUN_ID}/events`, { headers: { "last-event-id": last, cookie: `${VISITOR_COOKIE}=${owner.value}` } }), RUN_ID, deps);
    expect((await ask()).status).toBe(204);
    await store.set(posterKeys.lock(RUN_ID), "job");
    const open = await ask();
    expect(open.status).toBe(200);
    await open.body?.cancel();
  });
});
