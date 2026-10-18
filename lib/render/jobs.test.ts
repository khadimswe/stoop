import { describe, expect, it } from "vitest";
import { VIDEO_MODELS } from "../prompts/models.config";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import type { VisitorId } from "../store/visitor";
import { QueueError } from "./fal";
import { advanceRender, counterUsage, endUserId, giveBackAll, loadJob, LOST_REASON, pollRender, renderCounters, renderRoom, reserveAll, startRender, type RenderCaps, type RenderEnv } from "./jobs";
import { buildRenderPlan, renderSource } from "./plan";
import type { RenderPlan } from "./schema";
import { exampleFor, exampleReport, fakeStorage, FakeQueue, targetsOf, videoFetch } from "./testing";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = "2026-11-03";
const VISITOR = `v_${"1".repeat(24)}` as VisitorId;
const PASS = "b".repeat(24);
const CAPS: RenderCaps = { daily: 10, total: 20, perPass: 3, perIpDaily: 6 };

async function planFor(segmentIndex = 0, draftSeconds = 15): Promise<RenderPlan> {
  const report = exampleReport("food-hot-sauce");
  const target = targetsOf(report)[segmentIndex];
  return buildRenderPlan(renderSource(report, target, exampleFor(report)), { now: NOW, draftSeconds, demoBase: "https://stoop.example", photoUrl: async () => "" });
}

let ids = 0;
function setup(over: Partial<RenderEnv> = {}) {
  const store = new MemoryStore({ now: () => NOW });
  const queue = new FakeQueue();
  const storage = fakeStorage();
  const env: RenderEnv = { store, storage, queue, caps: CAPS, now: () => NOW, fetch: videoFetch(), newJobId: () => `rj_${(++ids).toString(16).padStart(24, "0")}`, ...over };
  return { env, store, queue, storage };
}

const counters = (passId = PASS, visitor: string = VISITOR, caps = CAPS) => renderCounters({ passId, visitor, day: DAY }, caps);

describe("render caps", () => {
  it("reserve every counter or none, and never leave one above its cap", async () => {
    const { store } = setup();
    const list = counters();
    for (let i = 0; i < 3; i++) expect(await reserveAll(store, list)).toEqual({ ok: true });
    expect(await reserveAll(store, list)).toEqual({ ok: false, full: "pass" });
    expect(await counterUsage(store, list)).toEqual({ pass: 3, ip: 3, day: 3, total: 3 });
    await giveBackAll(store, list);
    expect(renderRoom(list, await counterUsage(store, list))).toBe(1);
  });

  it("hold under concurrent reservations: 40 parallel requests from many passes and IPs never pass any cap", async () => {
    const { store } = setup();
    const caps: RenderCaps = { daily: 7, total: 9, perPass: 3, perIpDaily: 6 };
    const requests = Array.from({ length: 40 }, (_, i) => counters(`${(i % 8).toString(16)}`.repeat(24), `v_${(i % 3).toString().repeat(24)}`, caps));
    const results = await Promise.all(requests.map((list) => reserveAll(store, list)));
    const granted = results.filter((r) => r.ok).length;
    expect(granted).toBeLessThanOrEqual(caps.daily);
    expect((await store.get<number>(keys.daily("renders", DAY))) ?? 0).toBe(granted);
    expect((await store.get<number>(keys.render.total)) ?? 0).toBe(granted);
    for (let p = 0; p < 8; p++) expect((await store.get<number>(keys.render.pass(`${p.toString(16)}`.repeat(24)))) ?? 0).toBeLessThanOrEqual(caps.perPass);
    for (let v = 0; v < 3; v++) expect((await store.get<number>(keys.rate("render", `v_${v.toString().repeat(24)}` as VisitorId, DAY))) ?? 0).toBeLessThanOrEqual(caps.perIpDaily);
  });

  it("hold when parallel renders of different worlds race for the last of a pass's drafts", async () => {
    const { env, store, queue } = setup({ caps: { ...CAPS, perPass: 2 } });
    const plans = await Promise.all([0, 1, 2].map((i) => planFor(i)));
    const outcomes = await Promise.all(plans.map((plan) => startRender(env, { plan, passId: PASS, visitor: VISITOR })));
    expect(outcomes.filter((o) => o.kind === "started")).toHaveLength(2);
    expect(outcomes.filter((o) => o.kind === "capped")).toEqual([{ kind: "capped", full: "pass" }]);
    expect(queue.submitted).toHaveLength(2);
    expect(await store.get<number>(keys.render.pass(PASS))).toBe(2);
    expect(await store.get<number>(keys.daily("renders", DAY))).toBe(2);
  });
});

describe("a server-paid draft", () => {
  it("goes queued, rendering, done: the video is downloaded from fal's host and stored on Stoop's storage", async () => {
    const { env, queue, storage } = setup();
    const plan = await planFor();
    const started = await startRender(env, { plan, passId: PASS, visitor: VISITOR });
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    expect(started.job).toMatchObject({ status: "queued", charged: true, cached: false, visitor: VISITOR, day: DAY, durationSeconds: 15, falRequestId: "req-1", videoUrl: null });
    expect(queue.submitted[0]).toEqual({
      endpoint: VIDEO_MODELS.reference.endpoint,
      input: { prompt: plan.prompt, image_urls: plan.imageUrls, resolution: "480p", draft: true, duration: "15", aspect_ratio: "9:16", generate_audio: true, end_user_id: endUserId(PASS) },
    });
    expect(String(queue.submitted[0].input.end_user_id)).not.toContain(PASS);

    expect((await advanceRender(env, started.job.id))?.status).toBe("queued");
    expect((await advanceRender(env, started.job.id))?.status).toBe("rendering");
    const done = await advanceRender(env, started.job.id);
    expect(done).toMatchObject({ status: "done", videoUrl: `https://store.public.blob.vercel-storage.com/renders/${plan.inputHash}.mp4`, reason: null, usd: 3.31 });
    expect(storage.puts).toEqual([{ path: `renders/${plan.inputHash}.mp4`, bytes: 2048, contentType: "video/mp4" }]);
    // Done stays done: no more fal calls.
    const calls = queue.statusCalls;
    expect((await advanceRender(env, started.job.id))?.status).toBe("done");
    expect(queue.statusCalls).toBe(calls);
  });

  it("comes from the render cache at no cost when the exact same inputs rendered before", async () => {
    const { env, store, queue } = setup();
    const plan = await planFor();
    const first = await startRender(env, { plan, passId: PASS, visitor: VISITOR });
    if (first.kind !== "started") throw new Error("not started");
    await pollRender(env, first.job.id, { deadline: NOW + 60_000, sleep: async () => {} });
    const usageBefore = await counterUsage(store, counters("c".repeat(24)));
    const again = await startRender(env, { plan, passId: "c".repeat(24), visitor: VISITOR });
    expect(again.kind).toBe("cached");
    if (again.kind !== "cached") return;
    expect(again.job).toMatchObject({ status: "done", cached: true, charged: false, usd: 0, falRequestId: null });
    expect(again.job.videoUrl).toContain(plan.inputHash);
    expect(queue.submitted).toHaveLength(1);
    expect(await counterUsage(store, counters("c".repeat(24)))).toEqual(usageBefore);
    expect(await store.get<number>(keys.daily("renders", DAY))).toBe(1);
  });

  it("is shared while it renders: a second request for the same inputs joins it and reserves nothing", async () => {
    const { env, store, queue } = setup();
    const plan = await planFor();
    const [a, b] = await Promise.all([startRender(env, { plan, passId: PASS, visitor: VISITOR }), startRender(env, { plan, passId: "d".repeat(24), visitor: VISITOR })]);
    expect([a.kind, b.kind].sort()).toEqual(["joined", "started"]);
    expect(queue.submitted).toHaveLength(1);
    expect(await store.get<number>(keys.daily("renders", DAY))).toBe(1);

    // Ten at once (a judge mashing the button): one render, one count, everyone follows it.
    const many = setup();
    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, i) => startRender(many.env, { plan, passId: `${i}`.repeat(24), visitor: VISITOR })));
    expect(outcomes.filter((o) => o.kind === "started")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "joined")).toHaveLength(9);
    expect(many.queue.submitted).toHaveLength(1);
    expect(await many.store.get<number>(keys.daily("renders", DAY))).toBe(1);
    expect(await many.store.get<number>(keys.render.total)).toBe(1);
  });

  it("gives every counter back when fal refuses the job, and keeps them when fal may have taken it", async () => {
    const refused = setup();
    refused.queue.submitMode = "refuse";
    const plan = await planFor();
    const outcome = await startRender(refused.env, { plan, passId: PASS, visitor: VISITOR });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.job).toMatchObject({ status: "failed", charged: false, reason: "fal could not start the draft (HTTP 422)." });
    expect(await counterUsage(refused.store, counters())).toEqual({ pass: 0, ip: 0, day: 0, total: 0 });
    // The inputs are free again for a later try.
    expect(await refused.store.get(keys.render.cache(plan.inputHash))).toBeNull();

    const unknown = setup();
    unknown.queue.submitMode = "network";
    const lost = await startRender(unknown.env, { plan, passId: PASS, visitor: VISITOR });
    if (lost.kind === "failed") expect(lost.job.charged).toBe(true);
    expect(await counterUsage(unknown.store, counters())).toEqual({ pass: 1, ip: 1, day: 1, total: 1 });
  });

  it("fails without a refund when fal reports the render failed after taking it", async () => {
    const { env, store, queue } = setup();
    queue.states = ["COMPLETED"];
    queue.resultError = new QueueError("fal could not render the draft (HTTP 422).", 422, false);
    const plan = await planFor();
    const started = await startRender(env, { plan, passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect(await advanceRender(env, started.job.id)).toMatchObject({ status: "failed", reason: "fal could not render the draft (HTTP 422).", charged: true });
    expect(await store.get<number>(keys.render.pass(PASS))).toBe(1);
    expect(await store.get(keys.render.cache(plan.inputHash))).toBeNull();
  });

  it("refuses a result outside fal's media hosts, and never fetches it", async () => {
    let fetched = 0;
    const { env, queue, storage } = setup({
      fetch: (async () => {
        fetched++;
        return new Response("x");
      }) as typeof fetch,
    });
    queue.states = ["COMPLETED"];
    queue.output = { video: { url: "https://evil.example/files/draft.mp4" } };
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect(await advanceRender(env, started.job.id)).toMatchObject({ status: "failed", reason: "fal answered with a video outside its own media hosts." });
    expect(fetched).toBe(0);
    expect(storage.puts).toEqual([]);
  });

  it("refuses an oversized download, by its declared length or by what actually arrives", async () => {
    for (const fetch of [videoFetch({ length: String(200 * 1024 * 1024) }), videoFetch({ bytes: 65 * 1024 * 1024 })]) {
      const { env, queue, storage } = setup({ fetch });
      queue.states = ["COMPLETED"];
      const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
      if (started.kind !== "started") throw new Error("not started");
      expect(await advanceRender(env, started.job.id)).toMatchObject({ status: "failed", reason: "The draft is larger than Stoop keeps." });
      expect(storage.puts).toEqual([]);
    }
  });

  it("refuses a download that is not a video", async () => {
    const { env, queue } = setup({ fetch: videoFetch({ contentType: "text/html" }) });
    queue.states = ["COMPLETED"];
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect((await advanceRender(env, started.job.id))?.reason).toMatch(/could not be downloaded \(HTTP 200, text\/html\)/);
  });

  it("tries a billed draft again after a timeout, a network error or a 5xx, instead of failing it", async () => {
    let attempt = 0;
    const flaky = (async () => {
      attempt++;
      if (attempt === 1) throw new TypeError("socket hang up");
      if (attempt === 2) return new Response("busy", { status: 503 });
      return new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "video/mp4" } });
    }) as typeof fetch;
    const { env, queue } = setup({ fetch: flaky });
    queue.states = ["COMPLETED"];
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect((await advanceRender(env, started.job.id))?.status).toBe("queued");
    expect((await advanceRender(env, started.job.id))?.status).toBe("queued");
    queue.resultError = new QueueError("fal could not render the draft (HTTP 502).", 502, true);
    expect((await advanceRender(env, started.job.id))?.status).toBe("queued");
    queue.resultError = null;
    expect((await advanceRender(env, started.job.id))?.status).toBe("done");
  });

  it("ends a draft that keeps failing to arrive once it is two hours old, and on a 404 at once", async () => {
    const { env, queue } = setup({ fetch: (async () => new Response("gone", { status: 404 })) as typeof fetch });
    queue.states = ["COMPLETED"];
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect(await advanceRender(env, started.job.id)).toMatchObject({ status: "failed", reason: "The draft could not be downloaded (HTTP 404)." });

    const slow = setup({ fetch: (async () => new Response("busy", { status: 503 })) as typeof fetch });
    slow.queue.states = ["COMPLETED"];
    const pending = await startRender(slow.env, { plan: await planFor(1), passId: PASS, visitor: VISITOR });
    if (pending.kind !== "started") throw new Error("not started");
    expect((await advanceRender(slow.env, pending.job.id))?.status).toBe("queued");
    expect((await advanceRender({ ...slow.env, now: () => NOW + 3 * 60 * 60_000 }, pending.job.id))?.status).toBe("failed");
  });

  it("ends on done when two checkers race and only one of them stores the draft", async () => {
    let calls = 0;
    const racing = (async () => (++calls === 1 ? new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }) : new Response(new Uint8Array(512), { status: 200, headers: { "content-type": "video/mp4" } }))) as typeof fetch;
    const { env, store, queue } = setup({ fetch: racing });
    queue.states = ["COMPLETED"];
    const plan = await planFor();
    const started = await startRender(env, { plan, passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    await Promise.all([advanceRender(env, started.job.id), advanceRender(env, started.job.id)]);
    expect(await loadJob(store, started.job.id)).toMatchObject({ status: "done" });
    expect(await store.get(keys.render.cache(plan.inputHash))).toMatchObject({ state: "done", jobId: started.job.id });
  });

  it("never lets a slower checker put a finished draft back to rendering", async () => {
    const { env, store, queue } = setup();
    queue.states = ["COMPLETED"];
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowQueue = Object.assign(Object.create(queue) as FakeQueue, { status: async () => (await gate, "IN_PROGRESS" as const) });
    const slow = advanceRender({ ...env, queue: slowQueue }, started.job.id, { touch: true });
    expect((await advanceRender(env, started.job.id))?.status).toBe("done");
    release();
    expect((await slow)?.status).toBe("done");
    expect((await loadJob(store, started.job.id))?.status).toBe("done");
  });

  it("ends a job that never reached fal (its start died) after a few minutes, without a refund, and keeps its inputs held", async () => {
    const { env, store, queue } = setup();
    const plan = await planFor();
    const started = await startRender(env, { plan, passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    // As if the start had died before saving fal's request id.
    const stuck = { ...started.job, falRequestId: null };
    await store.set(keys.render.job(stuck.id), stuck);
    expect((await advanceRender(env, stuck.id))?.status).toBe("queued");
    const later = await advanceRender({ ...env, now: () => NOW + 6 * 60_000 }, stuck.id);
    expect(later).toMatchObject({ status: "failed", reason: LOST_REASON, charged: true });
    expect(await store.get<number>(keys.render.pass(PASS))).toBe(1);
    // fal may be rendering it, so the same inputs are not started again until the marker expires.
    expect(await store.get(keys.render.cache(plan.inputHash))).toEqual({ state: "pending", jobId: stuck.id });
    expect((await startRender(env, { plan, passId: "c".repeat(24), visitor: VISITOR })).kind).toBe("held");
    expect(queue.submitted).toHaveLength(1);
  });

  it("never fails, refunds or frees a job fal took when the store write after submit fails", async () => {
    const { env, store, queue } = setup();
    const plan = await planFor();
    // The store refuses every write of a job record that carries fal's request id.
    const set = store.set.bind(store);
    let refusals = 0;
    store.set = async (key, value, options) => {
      if (key.startsWith("render:job:") && (value as { falRequestId?: unknown }).falRequestId) {
        refusals++;
        throw new Error("store down");
      }
      return set(key, value, options);
    };
    const waits: number[] = [];
    const logged: string[] = [];
    const error = console.error;
    console.error = (message: string) => void logged.push(message);
    let outcome;
    try {
      outcome = await startRender({ ...env, sleep: async (ms) => void waits.push(ms) }, { plan, passId: PASS, visitor: VISITOR });
    } finally {
      console.error = error;
    }
    expect(outcome?.kind).toBe("started");
    expect(refusals).toBe(4);
    expect(waits).toEqual([200, 1_000, 3_000]);
    expect(queue.submitted).toHaveLength(1);
    expect(await counterUsage(store, counters())).toEqual({ pass: 1, ip: 1, day: 1, total: 1 });
    expect(await store.get(keys.render.cache(plan.inputHash))).toMatchObject({ state: "pending" });
    // The log names the job, never fal's request id, the pass or the visitor.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^Draft render rj_[0-9a-f]{24}: fal took it, but its request id could not be saved \(Error\)/);
    expect(logged[0]).not.toMatch(/req-1|b{24}|v_1/);
    // A second request for the same inputs follows the first job: nothing more is billed.
    store.set = set;
    expect((await startRender(env, { plan, passId: "c".repeat(24), visitor: VISITOR })).kind).toBe("joined");
    expect(queue.submitted).toHaveLength(1);
  });

  it("saves fal's request id after a store hiccup", async () => {
    const { env, store } = setup();
    const set = store.set.bind(store);
    let failOnce = true;
    store.set = async (key, value, options) => {
      if (failOnce && key.startsWith("render:job:") && (value as { falRequestId?: unknown }).falRequestId) {
        failOnce = false;
        throw new Error("blip");
      }
      return set(key, value, options);
    };
    const outcome = await startRender({ ...env, sleep: async () => {} }, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (outcome.kind !== "started") throw new Error("not started");
    expect((await loadJob(store, outcome.job.id))?.falRequestId).toBe("req-1");
  });

  it("is polled by the after() poller until it ends, and stops at the deadline otherwise", async () => {
    const { env, queue } = setup();
    const started = await startRender(env, { plan: await planFor(), passId: PASS, visitor: VISITOR });
    if (started.kind !== "started") throw new Error("not started");
    expect((await pollRender(env, started.job.id, { deadline: NOW + 60_000, sleep: async () => {} }))?.status).toBe("done");

    queue.states = ["IN_PROGRESS"];
    const slow = await startRender(env, { plan: await planFor(1), passId: PASS, visitor: VISITOR });
    if (slow.kind !== "started") throw new Error("not started");
    let clock = NOW;
    const stopped = await pollRender({ ...env, now: () => clock }, slow.job.id, { deadline: NOW + 20_000, intervalMs: 5_000, sleep: async (ms) => void (clock += ms) });
    expect(stopped?.status).toBe("rendering");
    expect(await loadJob(env.store, slow.job.id)).toMatchObject({ status: "rendering" });
  });
});
