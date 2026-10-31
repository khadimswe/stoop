// A live plan's id is also its share id: the plan routes give its owner (the browser that started it,
// or the MCP token that did) the whole plan, and anyone else only what the public event page shows.
// Tested against a MemoryStore, with a live plan built from a recorded example's events.
import { describe, expect, it, vi } from "vitest";
import { storeToken } from "../mcp/fixture-token";
import { dayOf, keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { tokenVisitorId, visitorId } from "../store/visitor";
import { describeRecorded } from "../testing/recorded";
import { mintVisitorCookie, VISITOR_COOKIE } from "../visitor-cookie";
import { createPlanEmitter, type PlanEvent } from "./events";
import { examplePlanId, PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES } from "./example-list";
import { loadExampleEvents } from "./examples";
import { isOwnerOf, ownerOnly, publicMarketingState, publicPlanReport } from "./owner";
import { samplePlanReport } from "./posts-fixture";
import { getPlan, getPlanEvents, PLAN_STREAMS_PER_PLAN, postPlan, type PlanRouteDeps } from "./routes";
import { PLANS_PER_NETWORK_DAILY, startPlan, type PlanStartContext } from "./runtime";
import { planReportSchema, type PlanInputs, type PlanReport } from "./schema";
import { appendPlanEvents, getPlanMeta, loadPlanReport, setPlanMeta, type PlanMeta } from "./store";
import { eventPageView } from "./view/event-page";
import { playView } from "./view/floor";
import { planView, sourceFromReport } from "./view/plan";

const SECRET = "s".repeat(40);
const RUN_ID = "plan_0123456789abcdef01234567";
const NOTES = "Ask for Dana at the counter about the back room";
const STORE_NUMBER = "Store 4821";
const owner = mintVisitorCookie(SECRET);
const ownerCookie = `${VISITOR_COOKIE}=${owner.value}`;
const strangerCookie = `${VISITOR_COOKIE}=${mintVisitorCookie(SECRET).value}`;
const at = "2026-10-29T12:00:00.000Z";

const request = (path: string, headers: Record<string, string> = {}) => new Request(`https://stoop.example${path}`, { headers });

function routeDeps(store: MemoryStore, env: Record<string, string> = { STOOP_SIGNING_SECRET: SECRET }): PlanRouteDeps {
  return { env, store: () => store, start: () => ({ execute: async () => {} }) };
}

/** A live plan in the store: a recorded example's events under a live id, with private details added. */
async function seedLivePlan(store: MemoryStore, meta: Partial<PlanMeta> = {}, slug = PLAN_EXAMPLES[0]!.slug): Promise<PlanReport> {
  const events = (await loadExampleEvents(slug)).map((e): PlanEvent => (e.type === "plan.started" ? { ...e, runId: RUN_ID, kind: "live", inputs: { ...e.inputs, notes: NOTES, store: { ...e.inputs.store, storeNumber: STORE_NUMBER } } } : e));
  const results = createPlanEmitter()({ type: "results.logged", results: { loggedAt: at, walkIns: 31, sales: 4, posted: { facebook: true, instagram: false, whatsapp: true }, notes: "Rain until noon" } });
  await appendPlanEvents(store, RUN_ID, [...events, results]);
  await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id, ...meta });
  return (await loadPlanReport(store, RUN_ID))!;
}

describeRecorded("the public view of a plan", () => {
  it.each(PLAN_EXAMPLES.map((e) => e.slug))("keeps exactly what the event page shows for %s, and stays a valid report", async (slug) => {
    const full = (await loadPlanReport(null, examplePlanId(slug)))!;
    const report: PlanReport = { ...full, inputs: { ...full.inputs, notes: NOTES, store: { ...full.inputs.store, storeNumber: STORE_NUMBER } } };
    const pub = publicPlanReport(report);
    expect(planReportSchema.safeParse(pub).success).toBe(true);
    // The public event page reads it exactly as it reads the whole plan.
    expect(eventPageView(sourceFromReport(pub, RUN_ID))).toEqual(eventPageView(sourceFromReport(report, RUN_ID)));
    // The plan page still renders it (the manager on another device sees this view).
    expect(() => planView(sourceFromReport(pub, RUN_ID))).not.toThrow();
    expect(pub).toMatchObject({ trace: [], results: [], posts: null, test: null, cost: null, baseline: null, comparison: null, local: { blockMusic: null, gaps: [] } });
    expect(pub.inputs.budgetUsd).toBe(0);
    expect(pub.plan?.concepts).toHaveLength(1);
    expect(pub.plan).toMatchObject({ runOfShow: [], checklist: [], estimatedCostUsd: 0 });
    // The table's facts only: the city's artists (the music the table plays) with their receipts, never
    // its styles; the places the food and the wheel name, no prices, and only the receipts those cite.
    expect(pub.local.city?.artists).toEqual(report.local.city?.artists);
    expect(pub.local.city?.styles).toEqual([]);
    for (const a of pub.local.city?.artists ?? []) for (const id of a.evidenceIds) expect(pub.ledger.some((e) => e.id === id)).toBe(true);
    // A stranger's plan page shows the playlist, and its music line keeps only artist refs.
    const music = pub.plan?.concepts[0]?.items.find((i) => i.kind === "music");
    const artistIds = new Set(pub.local.city?.artists.map((a) => a.id) ?? []);
    expect(music?.refs.every((id) => artistIds.has(id))).toBe(true);
    expect(playView(planView(sourceFromReport(pub, RUN_ID))).artists.length).toBeGreaterThan(0);
    expect(pub.plan?.shopping.every((s) => s.from && s.estUsd === undefined)).toBe(true);
    const shown = new Set([...(pub.plan?.shopping.map((s) => s.from) ?? []), ...(pub.plan?.wheel?.slices.flatMap((s) => s.refs) ?? [])]);
    expect(pub.local.block?.places.every((p) => shown.has(p.id)) ?? true).toBe(true);
    expect((pub.local.block?.places.length ?? 0) < (report.local.block?.places.length ?? 0)).toBe(true);
    const text = JSON.stringify(pub);
    const kept = new Set(pub.ledger.map((e) => e.id));
    for (const secret of [NOTES, STORE_NUMBER, ...report.ledger.map((e) => e.id).filter((id) => !kept.has(id))]) expect(text).not.toContain(secret);
    expect(pub.ledger.length).toBeLessThan(report.ledger.length);
    for (const concept of report.plan?.concepts.filter((c) => c.id !== report.plan?.conceptId) ?? []) expect(text).not.toContain(concept.hook);
    expect(pub.poster.prompt).toBe("");
  });
});

describeRecorded("the plan routes, for the owner and for anyone with the link", () => {
  it("give the owner the whole plan and its stream, and everyone else the public view", async () => {
    const store = new MemoryStore();
    const full = await seedLivePlan(store);
    const deps = routeDeps(store);

    const mine = await (await getPlan(RUN_ID, deps, request(`/api/plan/${RUN_ID}`, { cookie: ownerCookie }))).json();
    expect(mine).toMatchObject({ status: "done", owner: true, eventsUrl: `/api/plan/${RUN_ID}/events` });
    expect(mine.report.inputs.notes).toBe(NOTES);
    expect(mine.report.results).toHaveLength(1);

    for (const asked of [request(`/api/plan/${RUN_ID}`), request(`/api/plan/${RUN_ID}`, { cookie: strangerCookie }), request(`/api/plan/${RUN_ID}`, { cookie: `${VISITOR_COOKIE}=${owner.id}.forged` }), null]) {
      const response = await getPlan(RUN_ID, deps, asked);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: "done", owner: false, eventsUrl: null });
      expect(body.report).toEqual(publicPlanReport(full));
      expect(JSON.stringify(body)).not.toContain(STORE_NUMBER);
      expect(JSON.stringify(body)).not.toContain("Rain until noon");
    }

    const stream = await getPlanEvents(request(`/api/plan/${RUN_ID}/events`, { cookie: ownerCookie }), RUN_ID, deps);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);
    await stream.body?.cancel();
    expect((await getPlanEvents(request(`/api/plan/${RUN_ID}/events`), RUN_ID, deps)).status).toBe(403);
    expect((await getPlanEvents(request(`/api/plan/${RUN_ID}/events`, { cookie: strangerCookie }), RUN_ID, deps)).status).toBe(403);
  });

  it("keep examples public and read-only for everyone", async () => {
    const deps = routeDeps(new MemoryStore());
    const body = await (await getPlan("ex-atlanta-west-end", deps, request("/api/plan/ex-atlanta-west-end"))).json();
    expect(body).toMatchObject({ owner: false, eventsUrl: null });
    expect(body.report.ledger.length).toBeGreaterThan(0);
    const stream = await getPlanEvents(request("/api/plan/ex-atlanta-west-end/events"), "ex-atlanta-west-end", deps);
    expect(stream.status).toBe(200);
    await stream.body?.cancel();
  });

  it("let the MCP token that started a plan read it, and no other token", async () => {
    const store = new MemoryStore();
    const { token, hash } = await storeToken(store);
    const other = await storeToken(store);
    await seedLivePlan(store, { owner: undefined, visitor: tokenVisitorId(hash) });
    const deps = routeDeps(store);
    expect(await (await getPlan(RUN_ID, deps, request(`/api/plan/${RUN_ID}`, { authorization: `Bearer ${token}` }))).json()).toMatchObject({ owner: true });
    expect(await (await getPlan(RUN_ID, deps, request(`/api/plan/${RUN_ID}`, { authorization: `Bearer ${other.token}` }))).json()).toMatchObject({ owner: false });
    expect(await (await getPlan(RUN_ID, deps, request(`/api/plan/${RUN_ID}`))).json()).toMatchObject({ owner: false });
  });
});

describe("who owns a plan", () => {
  const meta = (extra: Partial<PlanMeta>): PlanMeta => ({ runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, ...extra });

  it("is the browser whose signed cookie started it", async () => {
    const store = new MemoryStore();
    const env = { STOOP_SIGNING_SECRET: SECRET };
    expect(await isOwnerOf(request("/", { cookie: ownerCookie }), meta({ owner: owner.id }), store, { env })).toBe(true);
    expect(await isOwnerOf(request("/", { cookie: strangerCookie }), meta({ owner: owner.id }), store, { env })).toBe(false);
    expect(await isOwnerOf(request("/"), meta({ owner: owner.id }), store, { env })).toBe(false);
    // A cookie signed with another secret, or a plan with no owner recorded, is nobody's.
    expect(await isOwnerOf(request("/", { cookie: `${VISITOR_COOKIE}=${mintVisitorCookie("o".repeat(40), owner.id).value}` }), meta({ owner: owner.id }), store, { env })).toBe(false);
    expect(await isOwnerOf(request("/", { cookie: ownerCookie }), meta({}), store, { env })).toBe(false);
  });

  it("falls back to the starter's salted IP only where there is no signing secret", async () => {
    const store = new MemoryStore();
    const here = { "x-forwarded-for": "203.0.113.7" };
    const starter = await visitorId(store, new Headers(here));
    expect(await isOwnerOf(request("/", here), meta({ visitor: starter }), store, { env: {} })).toBe(true);
    expect(await isOwnerOf(request("/", { "x-forwarded-for": "198.51.100.9" }), meta({ visitor: starter }), store, { env: {} })).toBe(false);
    // With a secret, the same IP is not enough.
    expect(await isOwnerOf(request("/", here), meta({ visitor: starter }), store, { env: { STOOP_SIGNING_SECRET: SECRET } })).toBe(false);
    // A production build or a Vercel deploy without the secret has no owners: never the IP.
    for (const env of [{ NODE_ENV: "production" }, { VERCEL: "1" }, { VERCEL_ENV: "preview" }]) {
      expect(await isOwnerOf(request("/", here), meta({ visitor: starter }), store, { env })).toBe(false);
    }
  });
});

describe("the owner-only write routes (marketing, posting to Meta)", () => {
  async function seeded() {
    const store = new MemoryStore();
    await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id });
    return store;
  }
  const env = { STOOP_SIGNING_SECRET: SECRET };

  it("run the handler only for the owner", async () => {
    const store = await seeded();
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const stranger = await ownerOnly(request(`/api/plan/${RUN_ID}/social/post`, { cookie: strangerCookie }), RUN_ID, () => store, handler, { env });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toMatchObject({ error: { code: "invalid" } });
    expect((await ownerOnly(request(`/api/plan/${RUN_ID}/marketing`), RUN_ID, () => store, handler, { env })).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect((await ownerOnly(request(`/api/plan/${RUN_ID}/marketing`, { cookie: ownerCookie }), RUN_ID, () => store, handler, { env })).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leave examples, unknown plans and bad ids to the handler's own answer, and fail closed without a store", async () => {
    const store = await seeded();
    const handler = vi.fn(async () => new Response(null, { status: 418 }));
    expect((await ownerOnly(request("/"), "ex-chicago-18th-street", () => store, handler, { env })).status).toBe(418);
    expect((await ownerOnly(request("/"), "../etc", () => store, handler, { env })).status).toBe(418);
    expect((await ownerOnly(request("/"), "plan_ffffffffffffffffffffffff", () => store, handler, { env })).status).toBe(418);
    const down = await ownerOnly(request("/", { cookie: ownerCookie }), RUN_ID, () => { throw new Error("no store"); }, handler, { env });
    expect(down.status).toBe(503);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("show anyone else the posters only, never the drafts", () => {
    const report = samplePlanReport();
    const posts = { facebook: { text: "Draft" }, instagram: { caption: "Draft", hashtags: [] }, whatsapp: { text: "Draft" }, share: {} };
    const poster = { status: "ready" as const, prompt: "art prompt", promptHash: "abc", url: "https://example.com/p.png", alt: "Poster" };
    const shown = publicMarketingState({ a: { conceptId: report.plan!.conceptId, poster, posts }, b: { conceptId: "other", poster, posts } });
    expect(shown).toEqual({ a: { conceptId: report.plan!.conceptId, poster: { status: "ready", prompt: "", promptHash: "", url: "https://example.com/p.png", alt: "Poster" }, posts: null }, b: { conceptId: "other", poster: { status: "ready", prompt: "", promptHash: "", url: "https://example.com/p.png", alt: "Poster" }, posts: null } });
  });
});

describe("open event streams", () => {
  it("are capped per plan for one visitor, and a closed one frees its place", async () => {
    const store = new MemoryStore();
    await appendPlanEvents(store, RUN_ID, [createPlanEmitter()({ type: "plan.started", runId: RUN_ID, kind: "live", inputs: PLAN_EXAMPLE_INPUTS["chicago-18th-street"] })]);
    await setPlanMeta(store, { runId: RUN_ID, status: "running", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id });
    const deps = routeDeps(store);
    const open = () => getPlanEvents(request(`/api/plan/${RUN_ID}/events`, { cookie: ownerCookie, "x-forwarded-for": "203.0.113.7" }), RUN_ID, deps);
    const streams = [];
    for (let i = 0; i < PLAN_STREAMS_PER_PLAN; i++) streams.push(await open());
    expect(streams.every((s) => s.status === 200)).toBe(true);
    const over = await open();
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("30");
    await streams[0]!.body!.cancel();
    const again = await open();
    expect(again.status).toBe(200);
    await Promise.all([again, ...streams.slice(1)].map((s) => s.body!.cancel()));
  });
});

describe("starting a plan from the browser", () => {
  const inputs: PlanInputs = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];
  const env = { STOOP_LIVE: "true", STOOP_SIGNING_SECRET: SECRET, LIVE_RUNS_DAILY_CAP: "30" };
  let n = 0;
  const deps = (store: MemoryStore | null): PlanRouteDeps => ({
    env,
    store: () => {
      if (!store) throw new Error("no store");
      return store;
    },
    start: () => ({ schedule: () => {}, execute: async () => {}, randomHex: () => String(++n).padStart(24, "0") }),
  });
  const post = (body: unknown, headers: Record<string, string> = {}, store: MemoryStore | null = null) =>
    postPlan(new Request("https://stoop.example/api/plan", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), deps(store));

  it("makes the starting browser the owner, and never joins someone else's identical plan", async () => {
    const store = new MemoryStore();
    const first = await post({ inputs }, {}, store);
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${VISITOR_COOKIE}=c_[0-9a-f]{24}\\.`));
    const cookie = setCookie.split(";")[0]!;
    const started = await first.json();
    expect(started).toMatchObject({ mode: "live", joined: false });
    expect((await getPlanMeta(store, started.id))?.owner).toBe(cookie.split("=")[1]!.split(".")[0]);

    const again = await (await post({ inputs }, { cookie }, store)).json();
    expect(again).toMatchObject({ mode: "live", joined: true, id: started.id });
    const someoneElse = await (await post({ inputs }, {}, store)).json();
    expect(someoneElse).toMatchObject({ mode: "live", joined: false });
    expect(someoneElse.id).not.toBe(started.id);
  });

  it("answers bad input with 400 and the field, never a 500", async () => {
    for (const store of [new MemoryStore(), null]) {
      const phone = await post({ inputs: { ...inputs, store: { ...inputs.store, phone: "call me maybe" } } }, {}, store);
      expect(phone.status).toBe(400);
      expect(await phone.json()).toEqual({ error: { code: "invalid", message: "Enter the phone as 10 digits, like 312-555-0142." }, field: "phone" });
    }
    const far = await post({ inputs: { ...inputs, date: dayOf(Date.now() + 40 * 86_400_000) } }, {}, new MemoryStore());
    expect(far.status).toBe(400);
    expect(await far.json()).toMatchObject({ field: "date", error: { message: "Pick an event date in the next 4 weeks." } });
    const offers = await post({ inputs: { ...inputs, offers: [{ text: "x".repeat(141) }] } }, {}, new MemoryStore());
    expect(await offers.json()).toMatchObject({ field: "offers" });
    const notJson = await postPlan(new Request("https://stoop.example/api/plan", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }), deps(new MemoryStore()));
    expect(notJson.status).toBe(415);
    const big = await post({ inputs, pad: "x".repeat(20_000) }, {}, new MemoryStore());
    expect(big.status).toBe(413);
  });

  it("counts a network's plans for the day, past the hourly limit", async () => {
    const store = new MemoryStore();
    const network = await visitorId(store, new Headers({ "x-forwarded-for": "2001:db8:1:2::5" }));
    await store.incr(keys.rate("plan-daily", network, dayOf()), { by: PLANS_PER_NETWORK_DAILY });
    const ctx: PlanStartContext = { store, visitor: network, source: "web", network };
    const reply = await startPlan({ env, execute: async () => {}, schedule: () => {} }, { inputs }, ctx);
    expect(reply).toMatchObject({ mode: "example", reason: "rate-limited", message: expect.stringContaining("today") });
  });

  it("gives the network's count back when a later check refuses the plan", async () => {
    const store = new MemoryStore();
    const network = await visitorId(store, new Headers({ "x-forwarded-for": "198.51.100.4" }));
    const ctx: PlanStartContext = { store, visitor: network, source: "web", network };
    const reply = await startPlan({ env: { ...env, LIVE_RUNS_DAILY_CAP: "0" }, execute: async () => {}, schedule: () => {} }, { inputs }, ctx);
    expect(reply).toMatchObject({ mode: "example", reason: "daily-cap" });
    expect(await store.get(keys.rate("plan-daily", network, dayOf()))).toBe(0);
  });
});
