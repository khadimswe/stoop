// Storyboard frames on the hot sauce example's recorded worlds, stored as a finished live run: fal is
// a fake renderer, storage is in memory, and Claude's review is the AI SDK mock. Covers the daily cap
// (counted for fresh renders only, given back when unused), the lock, the render cache across a
// resumed attempt, a paused and a failed job, the critique's re-renders and the cost record.
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { reduce, type RunEvent } from "../events";
import { FRAME_MODELS } from "../prompts/models.config";
import { claudeUsd } from "../runtime/cost";
import type { World } from "../report/world";
import { dayOf, keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { appendRunEvents, getRunMeta, loadReport, readRunEvents } from "../store/runs";
import type { Storage } from "../storage";
import { reportNames } from "../stages/after-run";
import { BASE_COST, exampleReport, knownArtist, LIVE_RUN_ID, storeExampleRun } from "../stages/fixture-run";
import { tokenVisitorId, visitorId, type CookieVisitorId } from "../store/visitor";
import { BLOCKED_REASON, createFalRenderer, falInput, FrameRenderError, isFalMedia, NO_SERVICE_REASON, PAUSED_REASON, renderWorldFrames, requestFrames, type FrameRenderer, type FrameRequest, type FramesEnv, type FramesJob, type FramesRouteDeps } from "./frames";
import { storyboardCounter } from "./storyboards";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const report = ifRecorded(() => exampleReport());
const olderWorld = ifRecorded(() => report.worlds.find((w) => w.segmentId === "seg-55-and-older")!);
const names = ifRecorded(() => reportNames(report));
/** A real name the recorded run knows, read from the recording. */
const KNOWN = ifRecorded(() => knownArtist(report));
const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 120, text: 120, reasoning: undefined } };

// Like Anthropic, the mock takes image URLs as they are, so the SDK never downloads them.
const IMAGE_URLS = { "image/*": [/^https:\/\/.*$/] };

type Review = { frames: { shot: number; issues: string[]; rewrite: string | null }[] };
function critic(answer: (shots: number[]) => Review) {
  return new MockLanguageModelV4({
    supportedUrls: IMAGE_URLS,
    doGenerate: async (options) => {
      const text = JSON.stringify(options.prompt);
      const shots = [...text.matchAll(/Shot (\d+) \(/g)].map((m) => Number(m[1]));
      return { content: [{ type: "text" as const, text: JSON.stringify(answer(shots)) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
    },
  });
}
const passing = () => critic((shots) => ({ frames: shots.map((shot) => ({ shot, issues: [], rewrite: null })) }));

function memoryStorage(): Storage & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    kind: "blob",
    objects,
    put: async (path, _bytes, contentType) => {
      objects.set(path, contentType);
      return { path, url: `https://frames.test/${path}` };
    },
    url: async (path) => (objects.has(path) ? `https://frames.test/${path}` : null),
    delete: async (path) => {
      objects.delete(path);
    },
  };
}

function fakeRenderer(fails: (request: FrameRequest, index: number) => boolean = () => false): FrameRenderer & { calls: FrameRequest[] } {
  const calls: FrameRequest[] = [];
  return {
    calls,
    render: async (request) => {
      calls.push(request);
      if (fails(request, calls.length - 1)) throw new FrameRenderError("fal could not render the frame (HTTP 500): ApiError.");
      return { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" };
    },
  };
}

let store: MemoryStore;
let clock: number;
beforeEach(() => {
  clock = Date.parse("2026-10-17T12:00:00.000Z");
  store = new MemoryStore({ now: () => clock });
});

const now = () => new Date(clock);
const env = (over: Partial<FramesEnv> = {}): FramesEnv => ({ store, storage: memoryStorage(), renderer: fakeRenderer(), model: passing(), framesCap: 200, now, ...over });
const job = (over: Partial<FramesJob> = {}): FramesJob => ({ runId: LIVE_RUN_ID, attempt: 1, segmentId: olderWorld.segmentId, world: olderWorld, product: report.inputs.product, names, ...over });
const used = async () => (await store.get<number>(keys.daily("frames", "2026-10-17"))) ?? 0;
const events = (attempt = 1) => readRunEvents(store, LIVE_RUN_ID, attempt);
const worldOf = async (attempt = 1): Promise<World> => reduce(await events(attempt)).worlds.find((w) => w.segmentId === olderWorld.segmentId)!;
const frameEvents = (list: RunEvent[]) => list.filter((e) => e.type === "world.frames").map((e) => (e.type === "world.frames" ? e.frames.status : null));
const labels = (list: RunEvent[]) => list.flatMap((e) => (e.type === "trace.step" && e.step.stage === "frames" ? [e.step.label] : []));

describeRecorded("renderWorldFrames", () => {
  it("renders 4 frames for a 5-scene concept, counts them against the cap, and refreshes the report", async () => {
    await storeExampleRun(store);
    const renderer = fakeRenderer();
    const outcome = await renderWorldFrames(env({ renderer }), job());
    expect(outcome.status).toBe("done");
    expect(renderer.calls).toHaveLength(4);
    // Described in text (no product photo), so the fast text model renders it.
    expect(renderer.calls.every((c) => c.model.endpoint === FRAME_MODELS.text.endpoint && c.referenceUrls.length === 0)).toBe(true);
    expect(await used()).toBe(4);
    const world = await worldOf();
    expect(world.frames?.status).toBe("done");
    expect(world.frames?.frames.map((f) => [f.scene, f.attempt])).toEqual([
      [0, 1],
      [1, 1],
      [3, 1],
      [4, 1],
    ]);
    expect(world.frames?.critiques.every((c) => c.issues.length === 0 && c.rewrite === null)).toBe(true);
    expect(frameEvents(await events())).toEqual(["rendering", "done"]);
    expect(labels(await events())).toContain("Rendered 4 storyboard frames for 55 and older · rock and classic rock");
    expect(labels(await events())).toContain("Frames 1, 2, 4 and 5 pass the checklist");
    expect((await loadReport(store, LIVE_RUN_ID))?.worlds.find((w) => w.segmentId === olderWorld.segmentId)?.frames?.status).toBe("done");
    // The lock is released once the job ends.
    expect(await store.get(keys.run.framesLock(LIVE_RUN_ID, 1, olderWorld.segmentId))).toBeNull();
  });

  it("adds the frames and the review to the run's last cost", async () => {
    await storeExampleRun(store);
    await renderWorldFrames(env(), job());
    const cost = reduce(await events()).cost!;
    expect(cost.frames).toBe(BASE_COST.frames + 4);
    expect(cost.claude.calls).toBe(BASE_COST.claude.calls + 1);
    expect(cost.claude.inputTokens).toBe(BASE_COST.claude.inputTokens + 900);
    // The frames at their price, plus the review's Claude call at list prices.
    const review = { inputTokens: cost.claude.inputTokens - BASE_COST.claude.inputTokens, outputTokens: cost.claude.outputTokens - BASE_COST.claude.outputTokens, cachedInputTokens: cost.claude.cachedInputTokens - BASE_COST.claude.cachedInputTokens };
    expect(cost.estimateUsd).toBeCloseTo(BASE_COST.estimateUsd + 4 * FRAME_MODELS.text.usdPerFrame + claudeUsd(review), 2);
    expect(cost.qloo).toEqual(BASE_COST.qloo);
  });

  it("renders a resumed attempt from the frame cache for free: nothing counted, nothing sent to fal", async () => {
    await storeExampleRun(store);
    await renderWorldFrames(env(), job());
    expect(await used()).toBe(4);
    await storeExampleRun(store, { attempt: 2 });
    const renderer = fakeRenderer();
    const outcome = await renderWorldFrames(env({ renderer }), job({ attempt: 2 }));
    expect(outcome.status).toBe("done");
    expect(renderer.calls).toHaveLength(0);
    expect(await used()).toBe(4);
    expect(outcome.cost.frames).toBe(0);
    expect((await worldOf(2)).frames?.frames).toEqual((await worldOf(1)).frames?.frames);
  });

  it("pauses when today's cap cannot cover the world, rendering nothing and giving the reservation back", async () => {
    await storeExampleRun(store);
    await store.incr(keys.daily("frames", "2026-10-17"), { by: 197 });
    const renderer = fakeRenderer();
    const outcome = await renderWorldFrames(env({ renderer, framesCap: 200 }), job());
    expect(outcome.status).toBe("paused");
    expect(renderer.calls).toHaveLength(0);
    expect(await used()).toBe(197);
    const world = await worldOf();
    expect(world.frames).toMatchObject({ status: "paused", reason: PAUSED_REASON, frames: [] });
    expect(labels(await events())).toContain("Storyboards paused today");
  });

  it("pauses without a frame service or storage, before touching the cap", async () => {
    await storeExampleRun(store);
    expect((await renderWorldFrames(env({ renderer: null }), job())).status).toBe("paused");
    expect((await worldOf()).frames?.reason).toBe(NO_SERVICE_REASON);
    expect(await used()).toBe(0);
  });

  it("skips while another job holds the world's lock, writing nothing", async () => {
    await storeExampleRun(store);
    await store.set(keys.run.framesLock(LIVE_RUN_ID, 1, olderWorld.segmentId), { revisionId: null }, { ttlSeconds: 600 });
    const before = (await events()).length;
    expect((await renderWorldFrames(env(), job())).status).toBe("skipped");
    expect((await events()).length).toBe(before);
    expect(await used()).toBe(0);
  });

  it("skips frames already done for the same pack", async () => {
    await storeExampleRun(store);
    await renderWorldFrames(env(), job());
    const renderer = fakeRenderer();
    expect((await renderWorldFrames(env({ renderer }), job())).status).toBe("skipped");
    expect(renderer.calls).toHaveLength(0);
  });

  it("fails when no frame renders, and gives every reservation back", async () => {
    await storeExampleRun(store);
    const outcome = await renderWorldFrames(env({ renderer: fakeRenderer(() => true) }), job());
    expect(outcome.status).toBe("failed");
    expect(await used()).toBe(0);
    expect((await worldOf()).frames).toMatchObject({ status: "failed", frames: [] });
    expect((await worldOf()).frames?.reason).toMatch(/^The frame service failed: fal could not render/);
  });

  it("keeps a frame fal rendered but storage lost on the cap and in the cost, so a broken store cannot render without end", async () => {
    await storeExampleRun(store);
    const storage = memoryStorage();
    storage.put = async () => {
      throw new Error("storage is down");
    };
    const outcome = await renderWorldFrames(env({ storage }), job());
    expect(outcome.status).toBe("failed");
    expect(await used()).toBe(4);
    expect(outcome.cost.frames).toBe(4);
    expect(reduce(await events()).cost?.frames).toBe(BASE_COST.frames + 4);
  });

  it("keeps a render cut off by the deadline on the cap", async () => {
    await storeExampleRun(store);
    const renderer = fakeRenderer();
    renderer.render = async () => {
      throw new FrameRenderError("fal could not render the frame: AbortError.", { billed: true });
    };
    expect((await renderWorldFrames(env({ renderer }), job())).status).toBe("failed");
    expect(await used()).toBe(4);
  });

  it("keeps the frames that rendered when one fails, counting only those", async () => {
    await storeExampleRun(store);
    const outcome = await renderWorldFrames(env({ renderer: fakeRenderer((_, i) => i === 1) }), job());
    expect(outcome.status).toBe("done");
    expect(await used()).toBe(3);
    expect((await worldOf()).frames?.frames).toHaveLength(3);
    expect(labels(await events()).some((l) => /^Frame \d did not render$/.test(l))).toBe(true);
  });

  it("re-renders each guardrailed rewrite once, keeps the first frame, and shows the before and after", async () => {
    await storeExampleRun(store);
    const renderer = fakeRenderer();
    const model = critic(() => ({
      frames: [
        { shot: 1, issues: ["product hidden behind the hand", "setting reads generic"], rewrite: "A weathered porch rail at dusk, the bottle upright in the foreground, sharp and centered." },
        { shot: 2, issues: ["readable text on the sign"], rewrite: `The scene styled like ${KNOWN} on stage.` },
        { shot: 4, issues: [], rewrite: null },
        { shot: 5, issues: [], rewrite: null },
      ],
    }));
    const outcome = await renderWorldFrames(env({ renderer, model }), job());
    expect(outcome.status).toBe("done");
    expect(renderer.calls).toHaveLength(5);
    const rerender = renderer.calls[4];
    expect(rerender.prompt.startsWith("A weathered porch rail at dusk")).toBe(true);
    // The closing rules are code's, so a rewrite keeps them.
    expect(rerender.prompt).toContain("No children, no school settings.");
    expect(await used()).toBe(5);
    const frames = (await worldOf()).frames!;
    expect(frames.frames.filter((f) => f.scene === 0).map((f) => f.attempt)).toEqual([1, 2]);
    expect(frames.critiques.find((c) => c.scene === 0)?.rewrite).toMatch(/^A weathered porch rail/);
    // The rewrite that names a real band never re-renders.
    expect(frames.critiques.find((c) => c.scene === 1)).toMatchObject({ issues: ["readable text on the sign"], rewrite: null });
    const steps = (await events()).flatMap((e) => (e.type === "trace.step" && e.step.stage === "frames" ? [e.step] : []));
    expect(steps.find((s) => s.label === "Frame 1: product hidden behind the hand, setting reads generic")?.reason).toMatch(/^Before: .+ After: A weathered porch rail/);
    expect(steps.find((s) => s.label === "Kept frame 2's prompt")?.reason).toContain("is a real name");
  });

  it("never shows a first render the review marks unsafe: only its re-render, or nothing", async () => {
    await storeExampleRun(store);
    const deleted: string[] = [];
    const del = store.del.bind(store);
    store.del = async (key: string) => (deleted.push(key), del(key));
    const renderer = fakeRenderer();
    const model = critic(() => ({
      frames: [
        { shot: 1, issues: ["the person at the rail may be under 18"], rewrite: "A weathered porch rail at dusk, the bottle upright in the foreground, an adult hand beside it.", unsafe: true },
        { shot: 2, issues: ["a beer brand's logo on the cooler"], rewrite: `The scene styled like ${KNOWN} on stage.`, unsafe: true },
        { shot: 4, issues: [], rewrite: null },
        { shot: 5, issues: [], rewrite: null },
      ],
    }));
    await renderWorldFrames(env({ renderer, model }), job());
    const frames = (await worldOf()).frames!;
    // Frame 1: its first render is held back and its clean re-render stands; frame 2 had no clean rewrite, so it is not shown at all.
    expect(frames.frames.filter((f) => f.scene === 0).map((f) => f.attempt)).toEqual([2]);
    expect(frames.frames.some((f) => f.scene === 1)).toBe(false);
    expect(frames.frames.filter((f) => f.scene === 3 || f.scene === 4)).toHaveLength(2);
    const steps = (await events()).flatMap((e) => (e.type === "trace.step" && e.step.stage === "frames" ? [e.step] : []));
    expect(steps.find((s) => s.label === "Held back frame 1")?.reason).toMatch(/only its re-render is shown/);
    expect(steps.find((s) => s.label === "Held back frame 2")?.reason).toMatch(/not shown/);
    // Their first renders leave the frame cache, so a retry is rendered and reviewed again; the kept ones stay.
    expect(deleted.filter((key) => key.startsWith("frames:render:"))).toHaveLength(2);
    for (const frame of frames.frames.filter((f) => f.attempt === 1)) expect(await store.get(keys.frames.render(frame.promptHash))).not.toBeNull();
  });

  it("takes nothing from the day's cap when its job is already stopped", async () => {
    await storeExampleRun(store);
    const stopped = new AbortController();
    stopped.abort(new Error("The run reached its time limit."));
    const outcome = await renderWorldFrames(env({ abortSignal: stopped.signal }), job());
    expect(outcome.status).toBe("failed");
    expect(await used()).toBe(0);
  });

  it("re-renders only what the cap still covers", async () => {
    await storeExampleRun(store);
    const renderer = fakeRenderer();
    const model = critic((shots) => ({ frames: shots.map((shot) => ({ shot, issues: ["product hidden"], rewrite: `Shot ${shot} again: the bottle sharp and centered on a porch rail at dusk.` })) }));
    const outcome = await renderWorldFrames(env({ renderer, model, framesCap: 6 }), job());
    expect(outcome.status).toBe("done");
    expect(renderer.calls).toHaveLength(6);
    expect(await used()).toBe(6);
    const frames = (await worldOf()).frames!;
    expect(frames.critiques.filter((c) => c.rewrite !== null)).toHaveLength(2);
    expect(labels(await events()).filter((l) => /^Kept frame \d as it was$/.test(l))).toHaveLength(2);
  });

  it("keeps the frames when the review fails", async () => {
    await storeExampleRun(store);
    const model = new MockLanguageModelV4({ supportedUrls: IMAGE_URLS, doGenerate: async () => ({ content: [{ type: "text" as const, text: "not json" }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] }) });
    const outcome = await renderWorldFrames(env({ model }), job());
    expect(outcome.status).toBe("done");
    expect((await worldOf()).frames?.frames).toHaveLength(4);
    expect(labels(await events())).toContain("Skipped the frame review");
  });

  it("references the product's own photo on the edit model, never a photo that shows a person", async () => {
    await storeExampleRun(store);
    const renderer = fakeRenderer();
    const product = {
      ...report.inputs.product,
      source: {
        kind: "images" as const,
        images: [
          { url: "https://shop.example.com/model-holding-bottle.jpg", showsPerson: true },
          { url: "https://shop.example.com/bottle.png", showsPerson: false },
        ],
      },
    };
    await renderWorldFrames(env({ renderer }), job({ product }));
    expect(renderer.calls.every((c) => c.model.endpoint === FRAME_MODELS.edit.endpoint)).toBe(true);
    expect(renderer.calls.every((c) => c.referenceUrls.length === 1 && c.referenceUrls[0] === "https://shop.example.com/bottle.png")).toBe(true);
  });
});

describe("the fal renderer", () => {
  const request: FrameRequest = { model: FRAME_MODELS.edit, prompt: "A bottle on a porch rail.", referenceUrls: ["https://shop.example.com/bottle.png"] };

  it("sends 9:16 at the draft settings and downloads the image", async () => {
    const subscribe = async (endpoint: string, options: { input?: unknown }) => {
      expect(endpoint).toBe("fal-ai/nano-banana-2/edit");
      expect(options.input).toEqual({ prompt: request.prompt, image_urls: request.referenceUrls, num_images: 1, aspect_ratio: "9:16", resolution: "1K", output_format: "png" });
      return { data: { images: [{ url: "https://v3.fal.media/files/frame.png" }] }, requestId: "r1" };
    };
    const fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    const renderer = createFalRenderer({ credentials: "test", client: { subscribe } as never, fetch: fetch as never });
    expect(await renderer.render(request)).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(falInput({ ...request, model: FRAME_MODELS.text, referenceUrls: [] })).toMatchObject({ image_size: "portrait_16_9", enable_safety_checker: true });
  });

  it("fetches only from fal's media hosts, and stops reading past the size cap", async () => {
    expect(isFalMedia("https://v3.fal.media/files/frame.png")).toBe(true);
    expect(isFalMedia("https://fal.media/files/frame.png")).toBe(true);
    expect(isFalMedia("https://storage.googleapis.com/falserverless/frame.png")).toBe(true);
    expect(isFalMedia("https://storage.googleapis.com/someone-else/frame.png")).toBe(false);
    expect(isFalMedia("https://evil.example/fal.media/frame.png")).toBe(false);
    expect(isFalMedia("http://v3.fal.media/files/frame.png")).toBe(false);
    const elsewhere = createFalRenderer({ credentials: "test", client: { subscribe: async () => ({ data: { images: [{ url: "https://evil.example/x.png" }] }, requestId: "r" }) } as never, fetch: (async () => new Response("")) as never });
    const error = (await elsewhere.render(request).catch((e: unknown) => e)) as FrameRenderError;
    expect(error.message).toMatch(/outside its own media hosts/);
    expect(error.billed).toBe(true);
    const huge = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const big = createFalRenderer({
      credentials: "test",
      client: { subscribe: async () => ({ data: { images: [{ url: "https://v3.fal.media/files/big.png" }] }, requestId: "r" }) } as never,
      fetch: (async () => new Response(huge, { headers: { "content-type": "image/png" } })) as never,
    });
    await expect(big.render(request)).rejects.toThrow("The rendered frame is too large.");
  });

  it("fails without echoing fal's error, and refuses a download that is not an image", async () => {
    const failing = createFalRenderer({ credentials: "test", client: { subscribe: async () => Promise.reject(Object.assign(new Error("prompt was: secret"), { status: 422 })) } as never });
    const error = (await failing.render(request).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(FrameRenderError);
    expect(error.message).toBe("fal could not render the frame (HTTP 422): Error.");
    const html = createFalRenderer({
      credentials: "test",
      client: { subscribe: async () => ({ data: { images: [{ url: "https://v3.fal.media/x" }] }, requestId: "r" }) } as never,
      fetch: (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as never,
    });
    await expect(html.render(request)).rejects.toThrow(/could not be downloaded/);
  });
});

describeRecorded("requestFrames (POST /api/frames/<id>)", () => {
  function deps(over: Partial<FramesRouteDeps> = {}) {
    const scheduled: (() => Promise<unknown>)[] = [];
    const jobs: FramesJob[] = [];
    const d: FramesRouteDeps = {
      live: true,
      store: () => store,
      headers: new Headers({ "x-forwarded-for": "203.0.113.7" }),
      configured: true,
      framesCap: 200,
      now: () => clock,
      schedule: (task) => scheduled.push(task),
      job: async (j) => {
        jobs.push(j);
        return { status: "done", frames: null, cost: { durationMs: 0, qloo: { live: 0, cached: 0 }, claude: { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0 } };
      },
      ...over,
    };
    return { d, scheduled, jobs };
  }
  const body = { segmentId: olderWorld.segmentId };

  it("refuses when live runs are off, before reading anything", async () => {
    const { d, scheduled } = deps({ live: false, store: () => Promise.reject(new Error("not read")) as never });
    const answer = await requestFrames(d, LIVE_RUN_ID, body);
    expect(answer.status).toBe(503);
    expect(answer.body).toMatchObject({ error: { code: "off" } });
    expect(scheduled).toHaveLength(0);
  });

  it("checks the run id and the body", async () => {
    const { d } = deps();
    expect((await requestFrames(d, "example-food-hot-sauce", body)).body).toMatchObject({ error: { code: "invalid" } });
    expect((await requestFrames(d, LIVE_RUN_ID, { segmentId: "Bad Id" })).body).toMatchObject({ error: { code: "invalid" } });
    expect((await requestFrames(d, LIVE_RUN_ID, { ...body, extra: 1 })).body).toMatchObject({ error: { code: "invalid" } });
    expect((await requestFrames(d, LIVE_RUN_ID, undefined)).status).toBe(400);
  });

  it("needs the run and the world", async () => {
    const { d } = deps();
    expect((await requestFrames(d, LIVE_RUN_ID, body)).status).toBe(404);
    await storeExampleRun(store);
    expect((await requestFrames(d, LIVE_RUN_ID, { segmentId: "seg-18-to-24" })).status).toBe(404);
  });

  it("fails closed when no shared store is configured", async () => {
    const { d } = deps({
      store: () => {
        throw new Error("No shared store is configured");
      },
    });
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toMatchObject({ error: { code: "failed" } });
  });

  it("starts the job after the response, for the world's own pack, with the run's product and names", async () => {
    await storeExampleRun(store);
    const { d, scheduled, jobs } = deps();
    const answer = await requestFrames(d, LIVE_RUN_ID, body);
    expect(answer).toEqual({ status: 202, body: { status: "rendering", message: null } });
    expect(jobs).toHaveLength(0);
    await scheduled[0]();
    expect(jobs[0]).toMatchObject({ runId: LIVE_RUN_ID, attempt: (await getRunMeta(store, LIVE_RUN_ID))!.attempt, segmentId: olderWorld.segmentId, revisionId: null, product: report.inputs.product });
    expect(jobs[0].names).toContain(KNOWN);
  });

  it("waits for the run to finish: the runtime renders frames itself while it runs", async () => {
    await storeExampleRun(store, { status: "running" });
    const { d, scheduled } = deps();
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toMatchObject({ error: { code: "busy" } });
    expect(scheduled).toHaveLength(0);
  });

  it("schedules nothing without a frame service", async () => {
    await storeExampleRun(store);
    const { d, scheduled } = deps({ configured: false });
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toEqual({ status: "paused", message: NO_SERVICE_REASON });
    expect(scheduled).toHaveLength(0);
  });

  it("starts again a rendering whose job died (its lock gone), and not one still holding its lock", async () => {
    await storeExampleRun(store);
    await appendRunEvents(store, LIVE_RUN_ID, 1, [{ type: "world.frames", segmentId: olderWorld.segmentId, frames: { revisionId: null, status: "rendering", reason: null, frames: [], critiques: [] } }]);
    const { d, scheduled } = deps();
    await store.set(keys.run.framesLock(LIVE_RUN_ID, 1, olderWorld.segmentId), { revisionId: null }, { ttlSeconds: 600 });
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toEqual({ status: "rendering", message: null });
    expect(scheduled).toHaveLength(0);
    await store.del(keys.run.framesLock(LIVE_RUN_ID, 1, olderWorld.segmentId));
    expect((await requestFrames(d, LIVE_RUN_ID, body)).status).toBe(202);
    expect(scheduled).toHaveLength(1);
  });

  it("never retries prompts the guardrails refused", async () => {
    await storeExampleRun(store);
    await appendRunEvents(store, LIVE_RUN_ID, 1, [{ type: "world.frames", segmentId: olderWorld.segmentId, frames: { revisionId: null, status: "failed", reason: BLOCKED_REASON, frames: [], critiques: [] } }]);
    const { d, scheduled } = deps();
    expect((await requestFrames(d, LIVE_RUN_ID, body)).status).toBe(409);
    expect(scheduled).toHaveLength(0);
  });

  it("limits each visitor per hour, by a salted hash of the IP", async () => {
    await storeExampleRun(store);
    const { d, scheduled } = deps({ perVisitorHour: 1 });
    expect((await requestFrames(d, LIVE_RUN_ID, body)).status).toBe(202);
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toMatchObject({ error: { code: "rate_limited" } });
    expect(scheduled).toHaveLength(1);
  });

  describe("storyboards per visitor per day", () => {
    const cookieA = "c_aaaaaaaaaaaaaaaaaaaaaaaa" as CookieVisitorId;
    const day = "2026-10-17";
    const ipOf = (ip = "203.0.113.7") => visitorId(store, new Headers({ "x-forwarded-for": ip }));

    it("hands the job the asker, and answers paused at once when the asker's day is spent by cookie or by IP", async () => {
      await storeExampleRun(store);
      const ask = (over: Partial<FramesRouteDeps> = {}) => {
        const made = deps({ cookieVisitor: cookieA, now: () => clock, ...over });
        return requestFrames(made.d, LIVE_RUN_ID, body).then((answer) => ({ answer, ...made }));
      };
      const first = await ask();
      expect(first.answer.status).toBe(202);
      await first.scheduled[0]();
      expect(first.jobs[0].visitor).toEqual({ id: await ipOf(), cookie: cookieA });
      await store.incr(storyboardCounter(cookieA, day), { by: 6 });
      const byCookie = await ask();
      expect(byCookie.answer).toEqual({ status: 200, body: { status: "paused", message: PAUSED_REASON } });
      expect(byCookie.scheduled).toHaveLength(0);
      // A cleared cookie (a new id) still counts against the same IP.
      await store.incr(storyboardCounter(await ipOf(), day), { by: 15 });
      expect((await ask({ cookieVisitor: null })).answer.body).toEqual({ status: "paused", message: PAUSED_REASON });
      // Another visitor is not affected.
      expect((await ask({ cookieVisitor: null, headers: new Headers({ "x-forwarded-for": "198.51.100.2" }) })).answer.status).toBe(202);
    });

    it("takes the visitor's place when the job renders fresh frames, by cookie and by IP", async () => {
      await storeExampleRun(store);
      const outcome = await renderWorldFrames(env(), job({ visitor: { id: await ipOf(), cookie: cookieA } }));
      expect(outcome.status).toBe("done");
      expect(await store.get(storyboardCounter(cookieA, day))).toBe(1);
      expect(await store.get(storyboardCounter(await ipOf(), day))).toBe(1);
    });

    it("pauses a job that needs fresh frames past the visitor's day, rendering nothing and taking nothing from the global cap", async () => {
      await storeExampleRun(store);
      const visitor = { id: await ipOf(), cookie: null };
      await store.incr(storyboardCounter(visitor.id, day), { by: 15 });
      const renderer = fakeRenderer();
      const outcome = await renderWorldFrames(env({ renderer }), job({ visitor }));
      expect(outcome.status).toBe("paused");
      expect(renderer.calls).toHaveLength(0);
      expect(await used()).toBe(0);
      expect((await worldOf()).frames).toMatchObject({ status: "paused", reason: PAUSED_REASON });
      expect(await store.get(storyboardCounter(visitor.id, day))).toBe(15);
    });

    it("needs no place for frames from the cache: a resumed attempt at the limit renders for free", async () => {
      await storeExampleRun(store);
      const visitor = { id: await ipOf(), cookie: cookieA };
      await renderWorldFrames(env(), job({ visitor }));
      await store.incr(storyboardCounter(cookieA, day), { by: 5 });
      await storeExampleRun(store, { attempt: 2 });
      const renderer = fakeRenderer();
      const outcome = await renderWorldFrames(env({ renderer }), job({ attempt: 2, visitor }));
      expect(outcome.status).toBe("done");
      expect(renderer.calls).toHaveLength(0);
      expect(await store.get(storyboardCounter(cookieA, day))).toBe(6);
    });

    it("gives the place back when nothing fresh rendered", async () => {
      await storeExampleRun(store);
      const visitor = { id: await ipOf(), cookie: cookieA };
      const outcome = await renderWorldFrames(env({ renderer: fakeRenderer(() => true) }), job({ visitor }));
      expect(outcome.status).toBe("failed");
      expect(await store.get(storyboardCounter(cookieA, day))).toBe(0);
      expect(await store.get(storyboardCounter(visitor.id, day))).toBe(0);
    });

    it("keeps the place when frames were billed and writing the result then failed", async () => {
      await storeExampleRun(store);
      const visitor = { id: await ipOf(), cookie: cookieA };
      // The store loses the job's last write (its world.frames result), after fal has rendered and billed.
      let writes = 0;
      const eventsKey = keys.run.events(LIVE_RUN_ID, 1);
      const flaky = new Proxy(store, {
        get(target, prop, receiver) {
          if (prop === "append")
            return (key: string, ...rest: unknown[]) => {
              if (key === eventsKey && ++writes === 2) return Promise.reject(new Error("write lost"));
              return (target.append as (...a: unknown[]) => Promise<number>).call(target, key, ...rest);
            };
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(renderWorldFrames(env({ store: flaky }), job({ visitor }))).rejects.toThrow("write lost");
      expect(await store.get(storyboardCounter(cookieA, day))).toBe(1);
      expect(await store.get(storyboardCounter(visitor.id, day))).toBe(1);
    });

    it("counts a run started over MCP against its token, with the same 15 a day", async () => {
      await storeExampleRun(store);
      const token = tokenVisitorId("f".repeat(64));
      await store.incr(storyboardCounter(token, day), { by: 15 });
      const outcome = await renderWorldFrames(env(), job({ visitor: { id: token, cookie: null } }));
      expect(outcome.status).toBe("paused");
      // The connector's shared IP is untouched.
      expect(await store.get(storyboardCounter(await ipOf(), day))).toBeNull();
    });

    it("never lets jobs that start at once pass the limit", async () => {
      await storeExampleRun(store);
      const visitor = { id: await ipOf(), cookie: null };
      await store.incr(storyboardCounter(visitor.id, day), { by: 14 });
      const worlds = report.worlds.filter((w) => w.pack !== null);
      expect(worlds.length).toBeGreaterThan(1);
      const outcomes = await Promise.all(worlds.map((w) => renderWorldFrames(env(), job({ segmentId: w.segmentId, world: w, visitor }))));
      expect(outcomes.filter((o) => o.status === "done")).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === "paused")).toHaveLength(worlds.length - 1);
      expect(await store.get(storyboardCounter(visitor.id, day))).toBe(15);
    });
  });

  it("does not start frames that are done, and answers paused while the cap is spent", async () => {
    await storeExampleRun(store);
    await renderWorldFrames(env(), job());
    const { d, scheduled } = deps();
    expect((await requestFrames(d, LIVE_RUN_ID, body)).body).toEqual({ status: "done", message: null });
    const other = report.worlds.find((w) => w.segmentId === "seg-35-to-44")!;
    await store.incr(keys.daily("frames", dayOf(clock)), { by: 500 });
    await renderWorldFrames(env(), job({ segmentId: other.segmentId, world: other }));
    expect((await requestFrames(d, LIVE_RUN_ID, { segmentId: other.segmentId })).body).toEqual({ status: "paused", message: PAUSED_REASON });
    expect(scheduled).toHaveLength(0);
  });
});
