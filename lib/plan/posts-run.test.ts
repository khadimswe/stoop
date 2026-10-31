// The marketing routes with fake dependencies: POST /api/plan/<id>/marketing (requestMarketing and the
// job it schedules, runMarketing) and GET /api/plan/<id>/marketing/poster.png (posterResponse), on a
// MemoryStore with the plan store (lib/plan/store.ts), a fake renderer and the AI SDK mock.
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Storage } from "../storage";
import { MemoryStore } from "../store/memory";
import type { VisitorId } from "../store/visitor";
import { reducePlan, createPlanEmitter, type PlanEventInput } from "./events";
import { POSTER_REASONS, posterKeys, type PosterRenderer } from "./poster-art";
import { POSTER_SIZES } from "./poster-image";
import { samplePlanReport } from "./posts-fixture";
import { AUTO_MARKETING_MIN_MS, autoMarketing, marketingResponseSchema, marketingState, marketingStateSchema, posterResponse, readVariant, requestMarketing, runMarketing, runRemake, sniffImage, trustedArtUrl, type MarketingRouteDeps } from "./posts-run";
import type { AbTest } from "./schema";
import { storePlanSource, type PlanSource } from "./posts-store";
import type { PlanReport } from "./schema";

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 50, text: 50, reasoning: undefined } };
const model = (output: unknown) =>
  new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text" as const, text: JSON.stringify(output) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] }) });
const openings = {
  facebook: "We're out front this Saturday with tacos from [[place-taqueria]] and the city's sound. Come say hi.",
  instagram: "Tacos from [[place-taqueria]] out front this Saturday.",
  hashtags: ["Testville", "ShopLocal", "TacoSaturday"],
  whatsapp: "Out front Saturday with tacos from [[place-taqueria]].",
};

const storage = (): Storage => ({
  kind: "blob",
  put: async (path) => ({ path, url: `https://abc123.public.blob.vercel-storage.com/${path}` }),
  url: async () => null,
  delete: async () => undefined,
});
const renderer = (): PosterRenderer & { calls: number } => {
  const r = { calls: 0, render: async () => (r.calls++, { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png" }) };
  return r;
};

const RUN = "plan_000000000000000000000001";
let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

/** Writes a live run's events, as the pipeline would, up to `upTo`. */
async function seedRun(report: PlanReport, upTo: "started" | "plan" | "done" | "failed" = "done") {
  const source = storePlanSource(store);
  const events: PlanEventInput[] = [{ type: "plan.started", runId: RUN, kind: "live", inputs: report.inputs }];
  for (const evidence of report.ledger) events.push({ type: "evidence.added", evidence });
  events.push({ type: "local.city", city: report.local.city! }, { type: "local.block", block: report.local.block! });
  if (upTo !== "started") events.push({ type: "plan.ready", plan: report.plan! });
  events.push({ type: "run.cost", cost: { durationMs: 1000, qloo: { live: 10, cached: 0 }, claude: { calls: 3, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 0 }, frames: 0, estimateUsd: 0.1 } });
  if (upTo === "done" || upTo === "plan") events.push({ type: "run.done" });
  if (upTo === "failed") events.push({ type: "run.failed", stage: "plan", message: "The plan writer failed." });
  if (upTo === "started") events.pop();
  await source.append(RUN, events);
  return source;
}

const routeDeps = (over: Partial<MarketingRouteDeps> = {}): MarketingRouteDeps & { scheduled: (() => Promise<unknown>)[] } => {
  const scheduled: (() => Promise<unknown>)[] = [];
  return {
    live: true,
    store: () => store,
    source: (s) => storePlanSource(s),
    headers: new Headers({ "x-forwarded-for": "203.0.113.9" }),
    schedule: (task) => scheduled.push(task),
    job: async () => true,
    scheduled,
    ...over,
  };
};

describe("requestMarketing", () => {
  it("answers examples at once: they ship with their poster and posts", async () => {
    const deps = routeDeps({ live: false });
    const answer = await requestMarketing(deps, "ex-chicago-18th-street");
    expect(answer.status).toBe(200);
    expect(marketingResponseSchema.parse(answer.body).status).toBe("done");
    expect(deps.scheduled).toHaveLength(0);
  });

  it("is off when live runs are off, and refuses bad or unknown ids", async () => {
    expect((await requestMarketing(routeDeps({ live: false }), RUN)).status).toBe(503);
    expect((await requestMarketing(routeDeps(), "../etc")).status).toBe(400);
    expect((await requestMarketing(routeDeps(), "plan_00000000000000000000beef")).status).toBe(404);
    expect((await requestMarketing(routeDeps(), "run_unknown1")).status).toBe(400);
    expect((await requestMarketing(routeDeps({ store: () => { throw new Error("no store"); } }), RUN)).status).toBe(503);
  });

  it("waits for the plan, and refuses a failed run", async () => {
    await seedRun(samplePlanReport(), "started");
    expect((await requestMarketing(routeDeps(), RUN)).status).toBe(409);
    store = new MemoryStore();
    await seedRun(samplePlanReport(), "failed");
    expect((await requestMarketing(routeDeps(), RUN)).status).toBe(409);
  });

  it("schedules the job once for a finished plan, then answers working while it holds the lock", async () => {
    await seedRun(samplePlanReport());
    const deps = routeDeps();
    const first = await requestMarketing(deps, RUN);
    expect(first.status).toBe(202);
    expect(deps.scheduled).toHaveLength(1);
    await store.set(posterKeys.lock(RUN), { at: "now" });
    const second = await requestMarketing(deps, RUN);
    expect(second).toMatchObject({ status: 202, body: { status: "working" } });
    expect(deps.scheduled).toHaveLength(1);
  });

  it("limits one visitor's requests in an hour", async () => {
    await seedRun(samplePlanReport());
    const deps = routeDeps({ perVisitorHour: 2 });
    await requestMarketing(deps, RUN);
    await requestMarketing(deps, RUN);
    expect((await requestMarketing(deps, RUN)).status).toBe(429);
  });
});

describe("runMarketing", () => {
  it("writes the queued poster, the posts with share links, the art and the cost, in that order", async () => {
    const source = await seedRun(samplePlanReport());
    const art = renderer();
    const visitor = { id: "v_000000000000000000000001" as VisitorId, cookie: null };
    expect(await runMarketing({ store, source, model: model(openings), art: { storage: storage(), renderer: art, framesCap: 10 }, origin: "https://stoop.test" }, RUN, visitor)).toBe(true);
    const state = (await source.state(RUN))!;
    const r = state.report;
    expect(r.posts?.facebook.text).toContain("tacos from Taqueria Fixture Grande");
    expect(new URL(r.posts!.share.facebook!).searchParams.get("u")).toBe(`https://stoop.test/e/${RUN}`);
    expect(new URL(r.posts!.share.whatsapp!).searchParams.get("text")).toContain(`https://stoop.test/e/${RUN}`);
    expect(r.poster.status).toBe("ready");
    expect(r.poster.url).toBeUndefined();
    expect(await store.get(posterKeys.render(r.poster.promptHash))).toMatchObject({ url: expect.stringMatching(/^https:\/\/abc123\.public\.blob\.vercel-storage\.com\/posters\//) });
    expect(art.calls).toBe(1);
    expect(r.cost).toMatchObject({ frames: 1, claude: { calls: 4, inputTokens: 1100, outputTokens: 550 } });
    expect(r.cost!.estimateUsd).toBeGreaterThan(0.1 + 0.08);
    expect(r.stats.stages.marketing).toBeDefined();
    expect(r.trace.filter((s) => s.stage === "marketing").map((s) => s.label)).toEqual(["Froze the poster art prompt", "Wrote the Facebook, Instagram and WhatsApp drafts", "Painted the poster background"]);
    // The lock is gone, and a second request answers done without a new job.
    expect(await store.get(posterKeys.lock(RUN))).toBeNull();
    const deps = routeDeps();
    expect((await requestMarketing(deps, RUN)).body).toMatchObject({ status: "done" });
    expect(deps.scheduled).toHaveLength(0);
  });

  it("still writes posts and a poster when fal is off: the template text on the plain background", async () => {
    const source = await seedRun(samplePlanReport());
    await runMarketing({ store, source, model: null, art: { storage: null, renderer: null }, origin: "https://stoop.test" }, RUN, null);
    const r = (await source.state(RUN))!.report;
    expect(r.posts?.facebook.text).toMatch(/^Taco Table Saturday/);
    expect(r.poster).toMatchObject({ status: "skipped" });
    expect(r.poster.reason).toBe(POSTER_REASONS.noService);
  });

  it("finishes with the template and the plain background when the writer or the art throws", async () => {
    const source = await seedRun(samplePlanReport());
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("invalid x-api-key");
      },
    });
    const throwing: PosterRenderer = { render: async () => Promise.reject(new Error("store down")) };
    await runMarketing({ store, source, model: broken, art: { storage: storage(), renderer: throwing, framesCap: 10 }, origin: "https://stoop.test" }, RUN, null);
    const r = (await source.state(RUN))!.report;
    expect(r.posts?.facebook.text).toMatch(/^Taco Table Saturday/);
    expect(r.poster.status).toBe("failed");
    expect(r.stats.stages.marketing).toBeDefined();
    expect(await store.get(posterKeys.lock(RUN))).toBeNull();
  });

  it("does nothing while another job holds the plan", async () => {
    const source = await seedRun(samplePlanReport());
    await store.set(posterKeys.lock(RUN), { at: "now" });
    expect(await runMarketing({ store, source, model: null, art: { storage: null, renderer: null }, origin: "https://stoop.test" }, RUN, null)).toBe(false);
    expect((await source.state(RUN))!.report.posts).toBeNull();
  });
});

describe("autoMarketing", () => {
  const VISITOR = "v_000000000000000000000001" as VisitorId;
  const realJob = (art = renderer()) => (s: MemoryStore, source: PlanSource, runId: string, visitor: Parameters<typeof runMarketing>[2]) =>
    runMarketing({ store: s, source, model: model(openings), art: { storage: storage(), renderer: art, framesCap: 10 }, origin: "https://stoop.test" }, runId, visitor);

  it("makes the poster and posts as soon as the plan is done, once, whoever else asks", async () => {
    const source = await seedRun(samplePlanReport());
    const art = renderer();
    const job = realJob(art);
    const jobs: string[] = [];
    const deps = { store, source, visitor: VISITOR, remainingMs: 200_000, job: async (s: never, src: PlanSource, id: string, v: Parameters<typeof runMarketing>[2]) => (jobs.push(id), job(store, src, id, v)) };
    expect(await autoMarketing(deps as never, RUN)).toBe("started");
    const r = (await source.state(RUN))!.report;
    expect(r.posts).not.toBeNull();
    expect(r.poster.status).toBe("ready");
    // Asked again, by the server or by the page: nothing new is made.
    expect(await autoMarketing(deps as never, RUN)).toBe("done");
    const route = routeDeps();
    expect((await requestMarketing(route, RUN)).body).toMatchObject({ status: "done" });
    expect(route.scheduled).toHaveLength(0);
    expect(jobs).toEqual([RUN]);
    expect(art.calls).toBe(1);
  });

  it("leaves a job already holding the lock alone, and a second job that races it does nothing", async () => {
    const source = await seedRun(samplePlanReport());
    await store.set(posterKeys.lock(RUN), "someone-else");
    let ran = 0;
    expect(await autoMarketing({ store, source, visitor: VISITOR, remainingMs: 200_000, job: async () => ran++ }, RUN)).toBe("working");
    expect(ran).toBe(0);
    // Even a job that slipped past the check finds the lock and writes nothing.
    expect(await realJob()(store, source, RUN, null)).toBe(false);
    expect((await source.state(RUN))!.report.posts).toBeNull();
  });

  it("waits for a finished plan and never runs for a failed one", async () => {
    let ran = 0;
    const job = async () => ran++;
    const started = await seedRun(samplePlanReport(), "started");
    expect(await autoMarketing({ store, source: started, visitor: VISITOR, remainingMs: 200_000, job }, RUN)).toBe("not-ready");
    store = new MemoryStore();
    const failed = await seedRun(samplePlanReport(), "failed");
    expect(await autoMarketing({ store, source: failed, visitor: VISITOR, remainingMs: 200_000, job }, RUN)).toBe("not-ready");
    expect(ran).toBe(0);
  });

  it("counts against the starter's hourly limit, shared with the route", async () => {
    const source = await seedRun(samplePlanReport());
    const route = routeDeps({ perVisitorHour: 1 });
    // The same salted visitor id the route counts (the IP's), as the plan's meta stores it.
    const { visitorId } = await import("../store/visitor");
    const visitor = await visitorId(store, route.headers);
    await requestMarketing(route, RUN);
    let ran = 0;
    expect(await autoMarketing({ store, source, visitor, remainingMs: 200_000, perVisitorHour: 1, job: async () => ran++ }, RUN)).toBe("rate-limited");
    expect(ran).toBe(0);
  });

  it("leaves the start to the page when the invocation is nearly out of time", async () => {
    const source = await seedRun(samplePlanReport());
    let ran = 0;
    expect(await autoMarketing({ store, source, visitor: VISITOR, remainingMs: AUTO_MARKETING_MIN_MS - 1, job: async () => ran++ }, RUN)).toBe("no-time");
    expect(ran).toBe(0);
  });

  it("passes the art job the starter, so the daily storyboard and frame caps still apply", async () => {
    const source = await seedRun(samplePlanReport());
    const art = renderer();
    // A frame cap of 0: the art is paused for today, and the poster says so on the plain background.
    const job = (s: MemoryStore, src: PlanSource, id: string, v: Parameters<typeof runMarketing>[2]) =>
      runMarketing({ store: s, source: src, model: null, art: { storage: storage(), renderer: art, framesCap: 0 }, origin: "https://stoop.test" }, id, v);
    let seen: unknown = null;
    expect(await autoMarketing({ store, source, visitor: VISITOR, remainingMs: 200_000, job: async (s, src, id, v) => ((seen = v), job(store, src, id, v)) }, RUN)).toBe("started");
    expect(seen).toEqual({ id: VISITOR, cookie: null });
    const r = (await source.state(RUN))!.report;
    expect(art.calls).toBe(0);
    expect(r.poster).toMatchObject({ status: "skipped", reason: expect.stringMatching(/paused for today/) });
  });
});

describe("a new version of the poster art", () => {
  const env = (art: PosterRenderer, source: PlanSource) => ({ store, source, model: null, art: { storage: storage(), renderer: art, framesCap: 10 }, origin: "https://stoop.test" });

  it("paints a new background under a new hash, keeps the posts, and is capped per plan", async () => {
    const source = await seedRun(samplePlanReport());
    const art = renderer();
    await runMarketing(env(art, source), RUN, null);
    const first = (await source.state(RUN))!.report;
    expect(first.poster.status).toBe("ready");
    const remakes: number[] = [];
    const deps = routeDeps({ remake: async (_s, _src, _id, _v, version) => remakes.push(version) });
    const answer = await requestMarketing(deps, RUN, { remake: "art" });
    expect(answer).toMatchObject({ status: 202, body: { status: "working" } });
    expect(remakes).toHaveLength(0);
    await deps.scheduled[0]!();
    expect(remakes).toEqual([1]);
    expect(await runRemake(env(art, source), RUN, null, 1)).toBe(true);
    const second = (await source.state(RUN))!.report;
    expect(second.poster.status).toBe("ready");
    expect(second.poster.promptHash).not.toBe(first.poster.promptHash);
    expect(second.poster.prompt).toBe(first.poster.prompt);
    expect(second.posts).toEqual(first.posts);
    expect(art.calls).toBe(2);
    expect(second.trace.filter((s) => s.stage === "marketing").map((s) => s.label).slice(-2)).toEqual(["Asked for poster version 2", "Painted a new poster background"]);
    // Three new versions at most.
    await requestMarketing(deps, RUN, { remake: "art" });
    await requestMarketing(deps, RUN, { remake: "art" });
    expect((await requestMarketing(deps, RUN, { remake: "art" })).status).toBe(429);
  });

  it("keeps the earlier poster when the new art does not render", async () => {
    const source = await seedRun(samplePlanReport());
    await runMarketing(env(renderer(), source), RUN, null);
    const before = (await source.state(RUN))!.report.poster;
    const broken: PosterRenderer = { render: async () => Promise.reject(new Error("down")) };
    await runRemake(env(broken, source), RUN, null, 1);
    const after = (await source.state(RUN))!.report;
    expect(after.poster).toEqual(before);
    expect(after.trace.at(-1)?.label).toBe("Kept the earlier poster");
  });

  it("is refused while art is not set up, since a new version could not change anything", async () => {
    const source = await seedRun(samplePlanReport());
    await runMarketing({ ...env(renderer(), source), art: { storage: null, renderer: null } }, RUN, null);
    const deps = routeDeps({ remake: async () => true });
    const answer = await requestMarketing(deps, RUN, { remake: "art" });
    expect(answer.status).toBe(409);
    expect(JSON.stringify(answer.body)).toContain(POSTER_REASONS.noService);
    expect(deps.scheduled).toHaveLength(0);
  });
});

describe("posterResponse", () => {
  const pngSize = async (response: Response) => {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer);
    return { signature: [...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join(""), width: view.getUint32(16), height: view.getUint32(20) };
  };

  const EX = "ex-chicago-18th-street";

  /** A source that knows one recorded example, built from a report the way the recorder writes it. */
  function exampleSource(report: PlanReport): PlanSource {
    const emit = createPlanEmitter(() => new Date("2026-10-28T15:00:00.000Z"));
    const inputs: PlanEventInput[] = [
      { type: "plan.started", runId: EX, kind: "example", inputs: report.inputs },
      ...report.ledger.map((evidence): PlanEventInput => ({ type: "evidence.added", evidence })),
      { type: "local.city", city: report.local.city! },
      { type: "local.block", block: report.local.block! },
      { type: "plan.ready", plan: report.plan! },
      { type: "poster.updated", poster: report.poster },
      { type: "run.done" },
    ];
    const state = reducePlan(inputs.map(emit));
    return { state: async (id) => (id === EX ? state : null), append: async () => undefined };
  }

  it("draws an example's poster at 1080 by 1350, and 1200 by 630 for link previews, without a store", async () => {
    const deps = { live: false, store: () => { throw new Error("no store"); }, source: () => exampleSource(samplePlanReport({ kind: "example" })), artOrigins: [] };
    const portrait = await posterResponse(deps, EX, "portrait");
    expect(portrait.status).toBe(200);
    expect(portrait.headers.get("content-type")).toBe("image/png");
    expect(portrait.headers.get("cache-control")).toMatch(/^public/);
    expect(await pngSize(portrait)).toEqual({ signature: "PNG", ...POSTER_SIZES.portrait });
    const og = await posterResponse(deps, EX, "og");
    expect(await pngSize(og)).toEqual({ signature: "PNG", ...POSTER_SIZES.og });
  });

  it("fits eight long offers and the wheel line on both sizes", async () => {
    const report = samplePlanReport({ kind: "example" });
    const offers = Array.from({ length: 8 }, (_, i) => ({ text: `Promo ${i + 1}: free phone when you switch to a new line, select models, taxes and fees extra` }));
    const wheel = { slices: ["promo", "gift_card", "snack", "other"].map((kind) => ({ label: "x", kind: kind as "promo", text: "x", origin: kind === "promo" ? ("yours" as const) : ("creative" as const), refs: [], evidenceIds: [] })), rules: ["Free to spin."] };
    const source = exampleSource({ ...report, inputs: { ...report.inputs, offers }, plan: { ...report.plan!, wheel } });
    const deps = { live: false, store: () => store, source: () => source, artOrigins: [] };
    expect(await pngSize(await posterResponse(deps, EX, "portrait"))).toEqual({ signature: "PNG", ...POSTER_SIZES.portrait });
    expect(await pngSize(await posterResponse(deps, EX, "og"))).toEqual({ signature: "PNG", ...POSTER_SIZES.og });
  });

  it("answers 404 for an unknown plan, and never fetches art from an untrusted host", async () => {
    const report = samplePlanReport({ kind: "example" });
    const source = exampleSource({ ...report, poster: { status: "ready", prompt: "p", promptHash: "h", alt: "a", url: "https://evil.test/art.png" } });
    const fetched: string[] = [];
    const fetchSpy = (async (url: string) => (fetched.push(url), new Response("x"))) as unknown as typeof fetch;
    const deps = { live: true, store: () => store, source: () => source, artOrigins: ["https://stoop.test"], fetch: fetchSpy, exampleArt: () => null };
    expect((await posterResponse(deps, "ex-missing", "portrait")).status).toBe(404);
    expect((await posterResponse(deps, "run_unknown1", "portrait")).status).toBe(404);
    expect((await posterResponse(deps, "plan_00000000000000000000beef", "portrait")).status).toBe(404);
    // An example never fetches a url: it draws only art the founder approved, from disk.
    const plain = await posterResponse(deps, EX, "portrait");
    expect(plain.status).toBe(200);
    expect(fetched).toEqual([]);
  });

  it("draws an example over its approved art, and variant B on the plain ground", async () => {
    const report = samplePlanReport({ kind: "example" });
    const source = exampleSource(report);
    const asked: string[] = [];
    const tiny = { dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" };
    const deps = { live: false, store: () => store, source: () => source, artOrigins: [], exampleArt: (slug: string) => (asked.push(slug), tiny) };
    const response = await posterResponse(deps, EX, "portrait");
    expect(asked).toEqual(["chicago-18th-street"]);
    expect(response.headers.get("cache-control")).toMatch(/^public/);
    expect((await pngSize(response)).width).toBe(1080);
  });

  it("draws a live plan over its rendered art, found in the art cache by its prompt hash", async () => {
    const hash = "a".repeat(64);
    const url = `https://abc123.public.blob.vercel-storage.com/posters/${hash}.png`;
    const source = await seedRun(samplePlanReport());
    await source.append(RUN, [{ type: "poster.updated", poster: { status: "ready", prompt: "p", promptHash: hash, alt: "a" } }]);
    await store.set(posterKeys.render(hash), { url, modelId: "fal-ai/nano-banana-2" });
    const tiny = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const fetched: string[] = [];
    const fetchSpy = (async (target: string) => (fetched.push(target), new Response(tiny, { headers: { "content-type": "image/png" } }))) as unknown as typeof fetch;
    const response = await posterResponse({ live: true, store: () => store, source: () => source, artOrigins: [], fetch: fetchSpy }, RUN, "portrait");
    expect(fetched).toEqual([url]);
    expect(response.headers.get("cache-control")).toMatch(/^public/);
    expect((await pngSize(response)).width).toBe(1080);
  });
});

describe("variant B", () => {
  const test: AbTest = {
    variants: [
      { id: "a", label: "Taco table", source: "concept", conceptId: "taco-table" },
      { id: "b", label: "Park picnic", source: "concept", conceptId: "park-picnic" },
    ],
    assignments: [
      { storeId: "test-store", date: "2026-11-07", variant: "a" },
      { storeId: "test-store", date: "2026-11-14", variant: "b" },
    ],
    metric: "walk_ins",
    decisionRule: "Keep the variant with more walk-ins than the store's usual Saturday.",
    caveat: "One weekend each is a first look, not proof.",
  };

  async function seedTested() {
    const source = await seedRun(samplePlanReport());
    await source.append(RUN, [{ type: "test.ready", test }]);
    return source;
  }

  it("writes a second poster and posts from the B concept, with share links to the B page", async () => {
    const source = await seedTested();
    const art = renderer();
    await runMarketing({ store, source, model: null, art: { storage: storage(), renderer: art, framesCap: 10 }, origin: "https://stoop.test" }, RUN, null);
    expect(art.calls).toBe(2);
    const b = (await readVariant(store, RUN))!;
    expect(b.conceptId).toBe("park-picnic");
    expect(b.posts?.facebook.text).toMatch(/^Picnic by the Commons/);
    expect(b.poster.status).toBe("ready");
    expect(new URL(b.posts!.share.facebook!).searchParams.get("u")).toBe(`https://stoop.test/e/${RUN}?variant=b`);
    const state = (await source.state(RUN))!.report;
    expect(state.posts?.facebook.text).toMatch(/^Taco Table Saturday/);
    expect(state.cost?.frames).toBe(2);
    expect(state.trace.map((s) => s.label)).toContain("Wrote variant B's poster and posts");
  });

  it("renders a B prompt that matches A's once: B reads A's art from the cache", async () => {
    const base = samplePlanReport();
    const plan = base.plan!;
    // Hooks and titles with digits give both concepts no feeling line, so both prompts come out the same.
    const same = { ...base, plan: { ...plan, concepts: plan.concepts.map((c) => ({ ...c, hook: "Open 12 to 4.", title: `${c.title} 2` })) } };
    const source = await seedRun(same);
    await source.append(RUN, [{ type: "test.ready", test }]);
    const art = renderer();
    await runMarketing({ store, source, model: null, art: { storage: storage(), renderer: art, framesCap: 10 }, origin: "https://stoop.test" }, RUN, null);
    expect(art.calls).toBe(1);
    const b = (await readVariant(store, RUN))!;
    const a = (await source.state(RUN))!.report.poster;
    expect(b.poster.promptHash).toBe(a.promptHash);
    expect(b.poster.url).toBe(a.url);
  });

  it("serves both variants, and B's poster with B's title", async () => {
    const source = await seedTested();
    await runMarketing({ store, source, model: null, art: { storage: null, renderer: null }, origin: "https://stoop.test" }, RUN, null);
    const deps = { live: true, store: () => store, source: () => source, artOrigins: [] };
    const body = marketingStateSchema.parse(await (await marketingState(deps, RUN)).json());
    expect(body.a.conceptId).toBe("taco-table");
    expect(body.b?.conceptId).toBe("park-picnic");
    const poster = await posterResponse(deps, RUN, "portrait", "b");
    expect(poster.status).toBe(200);
    expect(poster.headers.get("content-type")).toBe("image/png");
  });

  it("has no B for a plan without a test", async () => {
    const source = await seedRun(samplePlanReport());
    const deps = { live: true, store: () => store, source: () => source, artOrigins: [] };
    expect(marketingStateSchema.parse(await (await marketingState(deps, RUN)).json()).b).toBeNull();
    expect((await posterResponse(deps, RUN, "portrait", "b")).status).toBe(404);
  });
});

describe("sniffImage", () => {
  it("knows PNG, JPEG and WebP by their first bytes, and nothing else", () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from(Buffer.from("RIFF0000WEBPVP8 ")))).toBe("image/webp");
    expect(sniffImage(Uint8Array.from(Buffer.from("<html>")))).toBeNull();
  });
});

describe("trustedArtUrl", () => {
  it("trusts only https on the Blob store or a listed origin", () => {
    expect(trustedArtUrl("https://abc123.public.blob.vercel-storage.com/posters/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", [])).toBe(true);
    // On the Blob store, only the art job's own objects.
    expect(trustedArtUrl("https://abc123.public.blob.vercel-storage.com/frames/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", [])).toBe(false);
    expect(trustedArtUrl("https://other.public.blob.vercel-storage.com/anything.png", [])).toBe(false);
    expect(trustedArtUrl("https://stoop.test/demo/a/poster-bg.png", ["https://stoop.test"])).toBe(true);
    expect(trustedArtUrl("http://abc123.public.blob.vercel-storage.com/x.png", [])).toBe(false);
    expect(trustedArtUrl("https://evil.test/x.png", ["https://stoop.test"])).toBe(false);
    expect(trustedArtUrl("https://user:pw@stoop.test/x.png", ["https://stoop.test"])).toBe(false);
    expect(trustedArtUrl("https://public.blob.vercel-storage.com.evil.test/x.png", [])).toBe(false);
    expect(trustedArtUrl("not a url", [])).toBe(false);
  });
});
