import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { CONTROL_SEGMENT } from "../api/requests";
import { allowAll } from "../bot-check";
import type { ExampleSlug } from "../demo/examples";
import { issuePass, JUDGE_COOKIE, judgeConfig } from "../judge/pass";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { pollRender } from "./jobs";
import { photoPath } from "./photo";
import { createRenderAccessGet, createRenderPlanPost, createRenderPost, createRenderStatusGet, type RenderRouteDeps } from "./routes";
import { approvedFor, demoFor, exampleReport, fakePrivateStorage, fakeStorage, FakeQueue, LIVE_RUN_ID, liveReport, SLUGS, videoFetch } from "./testing";
import { describeRecorded, ifRecorded, itRecorded } from "../testing/recorded";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const SITE = "https://stoop.example";
const CODE = "judge-code-0123456789";
const ENV = {
  JUDGE_CODE: CODE,
  STOOP_SIGNING_SECRET: "s".repeat(32),
  ENABLE_LIVE_VIDEO: "true",
  STOOP_LIVE: "true",
  RENDERS_DAILY_CAP: "10",
  RENDERS_TOTAL_CAP: "20",
  RENDER_REFS_BASE_URL: SITE,
};
const HOT_SAUCE = ifRecorded(() => exampleReport("food-hot-sauce"));
const WORLD = ifRecorded(() => HOT_SAUCE.worlds[0].segmentId);
/** As if the founder had approved every example's prompt (the shipped approvals list none yet). */
const ALL_APPROVED: ReadonlySet<string> = ifRecorded(() => new Set(SLUGS.flatMap((slug) => [...approvedFor(exampleReport(slug))])));

async function png(): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c04020" } }).png().toBuffer());
}

function setup(over: { env?: Record<string, string>; queue?: FakeQueue | null; storage?: boolean; privateStorage?: boolean; approved?: ReadonlySet<string> } = {}) {
  const store = new MemoryStore({ now: () => NOW });
  const queue = over.queue === undefined ? new FakeQueue() : over.queue;
  const storage = fakeStorage();
  const privateStorage = fakePrivateStorage();
  const scheduled: (() => Promise<unknown>)[] = [];
  const fetchedImages: string[] = [];
  const env = { ...ENV, ...over.env };
  const deps: RenderRouteDeps = {
    env,
    store: () => store,
    botCheck: () => allowAll,
    now: () => NOW,
    loadReport: async (reportId) => {
      if (reportId === LIVE_RUN_ID) return liveReport();
      const slug = SLUGS.find((s) => `example-${s}` === reportId);
      return slug ? exampleReport(slug) : null;
    },
    demoMedia: (slug: ExampleSlug) => demoFor(exampleReport(slug)),
    approvedPrompts: () => over.approved ?? ALL_APPROVED,
    privateStorage: () => (over.privateStorage === false ? null : privateStorage),
    storage: () => (over.storage === false ? null : storage),
    queue: () => queue,
    schedule: (task) => void scheduled.push(task),
    fetch: videoFetch(),
    sleep: async () => {},
    fetchImage: async (url) => {
      fetchedImages.push(url);
      return { ok: true, url, finalUrl: url, status: 200, contentType: "image/png", bytes: await png(), redirects: 0 };
    },
  };
  const pass = (passId = "a".repeat(24), passEnv: Record<string, string> = env) => `${JUDGE_COOKIE}=${issuePass(judgeConfig(passEnv)!, NOW, passId)!.value}`;
  const send = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${SITE}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", origin: SITE, ...headers }, body: JSON.stringify(body) });
  const get = (path: string, headers: Record<string, string> = {}) => new Request(`${SITE}${path}`, { headers: { "x-forwarded-for": "203.0.113.5", ...headers } });
  return {
    store,
    queue,
    storage,
    privateStorage,
    scheduled,
    fetchedImages,
    pass,
    render: (target: unknown, headers?: Record<string, string>) => createRenderPost(deps)(send("/api/render", { target }, headers)),
    plan: (target: unknown, headers?: Record<string, string>) => createRenderPlanPost(deps)(send("/api/render/plan", { target }, headers)),
    access: (reportId: string, segment: string, headers?: Record<string, string>) => createRenderAccessGet(deps)(get(`/api/render/access?reportId=${reportId}&segment=${segment}`, headers)),
    status: (jobId: string) => createRenderStatusGet(deps)(get(`/api/render/${jobId}`), jobId),
    sendRaw: (request: Request) => createRenderPost(deps)(request),
  };
}

const target = (segment = WORLD, reportId = HOT_SAUCE.meta.id) => ({ reportId, segment });
const used = async (store: MemoryStore) => (await store.get<number>(keys.daily("renders", "2026-11-03"))) ?? 0;

describeRecorded("the exact Origin match on the paid routes", () => {
  it("refuses a request with no Origin header, before anything is built or reserved", async () => {
    const t = setup();
    const request = new Request(`${SITE}/api/render`, { method: "POST", headers: { "content-type": "application/json", cookie: t.pass() }, body: JSON.stringify({ target: target() }) });
    const response = await t.sendRaw(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "invalid", message: "Requests from other sites are not accepted." } });
    expect(t.queue?.submitted).toEqual([]);
    expect(await used(t.store)).toBe(0);
  });

  it("refuses another site's Origin (and the opaque 'null' one), with the judge's own cookie attached", async () => {
    const t = setup();
    for (const origin of ["https://evil.example", "null", "https://stoop.example.evil.example", "http://stoop.example"]) {
      const response = await t.render(target(), { origin, cookie: t.pass() });
      expect(response.status, origin).toBe(403);
    }
    expect((await t.plan(target(), { origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new Request(`${SITE}/api/render/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: target() }) });
    expect((await createRenderPlanPost({ ...({} as RenderRouteDeps), env: ENV })(noOrigin)).status).toBe(403);
    expect(t.queue?.submitted).toEqual([]);
    expect(await used(t.store)).toBe(0);
  });

  it("accepts the site's own origin, and NEXT_PUBLIC_APP_URL's when the request came in on another host", async () => {
    const t = setup();
    expect((await t.render(target(), { cookie: t.pass() })).status).toBe(202);
    const app = setup({ env: { NEXT_PUBLIC_APP_URL: "https://stoop.app" } });
    const response = await app.sendRaw(
      new Request(`${SITE}/api/render/plan`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", origin: "https://stoop.app" }, body: JSON.stringify({ target: target() }) }),
    );
    expect(response.status).toBe(403);
    expect((await app.plan(target(), { origin: "https://stoop.app" })).status).toBe(200);
  });
});

describeRecorded("POST /api/render", () => {
  it("needs a judge pass: without one, or with one from before the code rotated, nothing renders", async () => {
    const t = setup();
    const none = await t.render(target());
    expect(none.status).toBe(403);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("off");
    const rotated = setup({ env: { JUDGE_CODE: "the-next-judge-code-42" } });
    const old = (await rotated.render(target(), { cookie: t.pass("a".repeat(24), ENV) })).status;
    expect(old).toBe(403);
    expect(rotated.queue?.submitted).toEqual([]);
  });

  it("stays off without ENABLE_LIVE_VIDEO, STOOP_LIVE, FAL_KEY, storage, or with a zero cap", async () => {
    for (const t of [
      setup({ env: { ENABLE_LIVE_VIDEO: "false" } }),
      setup({ env: { STOOP_LIVE: "false" } }),
      setup({ env: { RENDERS_DAILY_CAP: "0" } }),
      setup({ env: { RENDERS_TOTAL_CAP: "0" } }),
      setup({ queue: null }),
      setup({ storage: false }),
    ]) {
      const response = await t.render(target(), { cookie: t.pass() });
      expect(response.status).toBe(503);
      expect(await used(t.store)).toBe(0);
    }
  });

  it("starts a draft, finishes it after the response, and shows a page only the safe fields", async () => {
    const t = setup();
    const response = await t.render(target(), { cookie: t.pass() });
    expect(response.status).toBe(202);
    const { job } = (await response.json()) as { job: Record<string, unknown> };
    expect(job).toEqual({ id: expect.stringMatching(/^rj_[0-9a-f]{24}$/), target: target(), status: "queued", videoUrl: null, reason: null, cached: false });
    expect(t.scheduled).toHaveLength(1);
    await t.scheduled[0]();
    const status = (await (await t.status(job.id as string)).json()) as { job: Record<string, unknown> };
    expect(status.job.status).toBe("done");
    expect(status.job.videoUrl).toMatch(/^https:\/\/store\.public\.blob\.vercel-storage\.com\/renders\/[0-9a-f]{64}\.mp4$/);
    expect(Object.keys(status.job)).not.toContain("falRequestId");
    expect(JSON.stringify(status)).not.toContain("a".repeat(24));
  });

  it("allows 3 drafts per pass, then answers the budget line; a cached draft is free and not counted", async () => {
    const t = setup();
    const cookie = t.pass();
    const targets = [target(HOT_SAUCE.worlds[0].segmentId), target(HOT_SAUCE.worlds[1].segmentId), target(CONTROL_SEGMENT)];
    for (const tg of targets) expect((await t.render(tg, { cookie })).status).toBe(202);
    const fourth = await t.render(target(exampleReport("home-candles").worlds[0].segmentId, "example-home-candles"), { cookie });
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: { code: "daily_cap", message: "This judge pass has used its draft renders. The storyboard and the example clip are still here." } });
    for (const task of t.scheduled) await task();
    // Another judge asks for a draft that already rendered: free, counted nowhere.
    const before = await used(t.store);
    const cached = await t.render(targets[0], { cookie: t.pass("e".repeat(24)) });
    expect(cached.status).toBe(200);
    expect(((await cached.json()) as { job: { cached: boolean; status: string } }).job).toMatchObject({ cached: true, status: "done" });
    expect(await used(t.store)).toBe(before);
    expect(await t.store.get(keys.render.pass("e".repeat(24)))).toBeNull();
  });
});

describeRecorded("GET /api/render/access", () => {
  it("says byok to visitors without a pass, and off when BYOK is off too", async () => {
    expect(await (await setup().access(HOT_SAUCE.meta.id, WORLD)).json()).toEqual({ video: "byok", rendersLeft: null, byok: true });
    expect(await (await setup({ env: { ENABLE_BYOK: "false" } }).access(HOT_SAUCE.meta.id, WORLD)).json()).toEqual({ video: "off", rendersLeft: null, byok: false });
  });

  it("says judge with the drafts left, then budget-used once the pass is spent", async () => {
    const t = setup();
    const cookie = t.pass();
    expect(await (await t.access(HOT_SAUCE.meta.id, WORLD, { cookie })).json()).toEqual({ video: "judge", rendersLeft: 3, byok: true });
    await t.render(target(), { cookie });
    expect(await (await t.access(HOT_SAUCE.meta.id, WORLD, { cookie })).json()).toEqual({ video: "judge", rendersLeft: 2, byok: true });
    await t.render(target(HOT_SAUCE.worlds[1].segmentId), { cookie });
    await t.render(target(CONTROL_SEGMENT), { cookie });
    expect(await (await t.access(HOT_SAUCE.meta.id, WORLD, { cookie })).json()).toEqual({ video: "budget-used", rendersLeft: 0, byok: true });
  });

  it("says off for an example whose prompt the founder has not approved, and the plan and render refuse it", async () => {
    const t = setup({ approved: new Set() });
    expect(await (await t.access(HOT_SAUCE.meta.id, WORLD, { cookie: t.pass() })).json()).toEqual({ video: "off", rendersLeft: 3, byok: false });
    const plan = await t.plan(target());
    expect(plan.status).toBe(409);
    expect(await plan.json()).toEqual({ error: { code: "off", message: "This example's prompt is not approved for rendering yet." } });
    expect((await t.render(target(), { cookie: t.pass() })).status).toBe(409);
    expect(t.queue?.submitted).toEqual([]);
    expect(await used(t.store)).toBe(0);
    // Approving only this world's prompt opens only this world.
    const one = setup({ approved: new Set([HOT_SAUCE.worlds[0].pack!.renders.find((r) => r.kind === "multi-shot")!.promptHash]) });
    expect(((await (await one.access(HOT_SAUCE.meta.id, WORLD)).json()) as { video: string }).video).toBe("byok");
    expect(((await (await one.access(HOT_SAUCE.meta.id, HOT_SAUCE.worlds[1].segmentId)).json()) as { video: string }).video).toBe("off");
  });

  it("says off for a live world that needs the brand's photo when no private store is set up", async () => {
    const t = setup({ privateStorage: false });
    const segment = liveReport().worlds[0].segmentId;
    expect(await (await t.access(LIVE_RUN_ID, segment, { cookie: t.pass() })).json()).toEqual({ video: "off", rendersLeft: 3, byok: false });
    expect((await t.plan({ reportId: LIVE_RUN_ID, segment })).status).toBe(503);
    expect(await (await setup().access(LIVE_RUN_ID, segment)).json()).toEqual({ video: "byok", rendersLeft: null, byok: true });
  });

  it("falls back to byok for a pass while server drafts are off, and to off where nothing can render", async () => {
    const off = setup({ env: { ENABLE_LIVE_VIDEO: "false" } });
    expect(await (await off.access(HOT_SAUCE.meta.id, WORLD, { cookie: off.pass() })).json()).toEqual({ video: "byok", rendersLeft: null, byok: true });
    const preview = setup({ env: { RENDER_REFS_BASE_URL: "", VERCEL_ENV: "preview" } });
    expect(await (await preview.access(HOT_SAUCE.meta.id, WORLD, { cookie: preview.pass() })).json()).toEqual({ video: "off", rendersLeft: 3, byok: false });
    expect((await setup().access(HOT_SAUCE.meta.id, "seg-nope")).status).toBe(404);
    expect((await setup().access("example-nope", WORLD)).status).toBe(404);
    expect((await setup().access("nope", WORLD)).status).toBe(400);
  });
});

describeRecorded("POST /api/render/plan", () => {
  it("answers the plan built on the server, whatever else the request carries", async () => {
    const t = setup();
    const response = await t.plan(target());
    expect(response.status).toBe(200);
    const { plan } = (await response.json()) as { plan: { prompt: string; imageUrls: string[] } };
    expect(plan.imageUrls[0]).toBe(`${SITE}/demo/food-hot-sauce/packshot.webp`);
    // The browser sends a target only: a prompt in the body is refused, never rendered.
    const withPrompt = await t.sendRaw(new Request(`${SITE}/api/render`, { method: "POST", headers: { "content-type": "application/json", origin: SITE, cookie: t.pass() }, body: JSON.stringify({ target: target(), prompt: "anything" }) }));
    expect(withPrompt.status).toBe(400);
  });

  it("stays off when BYOK is off, unless a judge pass asks", async () => {
    const t = setup({ env: { ENABLE_BYOK: "false" } });
    expect((await t.plan(target())).status).toBe(503);
    expect((await t.plan(target(), { cookie: t.pass() })).status).toBe(200);
  });

  it("re-encodes a live run's brand photo into private storage once and presigns it for an hour on every plan", async () => {
    const t = setup();
    const live = { reportId: LIVE_RUN_ID, segment: liveReport().worlds[0].segmentId };
    const first = (await (await t.plan(live)).json()) as { plan: { imageUrls: string[]; expiresAt: string } };
    expect(first.plan.imageUrls[0]).toMatch(/^https:\/\/refs\.private\.blob\.vercel-storage\.com\/refs\/photos\/[0-9a-f]{40}\.webp\?vercel-blob-valid-until=/);
    expect(first.plan.expiresAt).toBe(new Date(NOW + 3_600_000).toISOString());
    await t.plan(live);
    expect(t.fetchedImages).toEqual(["https://cdn.shop.example/products/sauce.jpg"]);
    expect(t.privateStorage.signed).toHaveLength(2);
    const stored = t.privateStorage.objects.get(photoPath("https://cdn.shop.example/products/sauce.jpg"));
    expect((await sharp(stored!).metadata()).format).toBe("webp");
    // The store never holds a signed URL.
    expect(JSON.stringify([...(t.store as unknown as { entries: Map<string, unknown> }).entries.values()])).not.toContain("vercel-blob-signature");
  });
});

describe("GET /api/render/<jobId>", () => {
  itRecorded("checks fal only when no poller has touched the job lately, after answering, and only once", async () => {
    const t = setup();
    const { job } = (await (await t.render(target(), { cookie: t.pass() })).json()) as { job: { id: string } };
    const calls = t.queue!.statusCalls;
    const tasks = t.scheduled.length;
    expect(((await (await t.status(job.id)).json()) as { job: { status: string } }).job.status).toBe("queued");
    expect(t.queue!.statusCalls).toBe(calls);
    expect(t.scheduled).toHaveLength(tasks);
    // A poller that stopped long ago: the status poll answers at once and checks fal after the response.
    const later = setup();
    const started = (await (await later.render(target(), { cookie: later.pass() })).json()) as { job: { id: string } };
    await pollRender({ store: later.store, storage: later.storage, queue: later.queue!, caps: { daily: 10, total: 20, perPass: 3, perIpDaily: 6 }, now: () => NOW - 120_000 }, started.job.id, { deadline: 0 });
    const before = later.scheduled.length;
    expect(((await (await later.status(started.job.id)).json()) as { job: { status: string } }).job.status).toBe("queued");
    expect(later.scheduled).toHaveLength(before + 1);
    // The touch keeps the next polls from scheduling more checks.
    await later.status(started.job.id);
    expect(later.scheduled).toHaveLength(before + 1);
    await later.scheduled.at(-1)!();
    expect(((await (await later.status(started.job.id)).json()) as { job: { status: string } }).job.status).toBe("rendering");
  });

  it("refuses ids that are not job ids, and says when a job is gone", async () => {
    const t = setup();
    expect((await t.status("rj_nope")).status).toBe(400);
    expect((await t.status(`rj_${"0".repeat(24)}`)).status).toBe(404);
  });
});
