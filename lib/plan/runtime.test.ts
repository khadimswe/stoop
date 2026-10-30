import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store/memory";
import { keys } from "../store/keys";
import type { RequestContext } from "../runtime/types";
import type { VisitorId } from "../store/visitor";
import { describeRecorded } from "../testing/recorded";
import { mintVisitorCookie, VISITOR_COOKIE } from "../visitor-cookie";
import { createPlanEmitter, reducePlan, toPlanReport, type PlanEvent } from "./events";
import { examplePlanId, PLAN_EXAMPLE_INPUTS } from "./example-list";
import { loadExampleEvents } from "./examples";
import { replayClient, replayPlanModel } from "./replay";
import { getPlan, getPlanEvents, postPlanResults, type PlanRouteDeps } from "./routes";
import { exampleFor, executePlan, MAX_EVENT_DAYS_AHEAD, startPlan, type PlanStartDeps } from "./runtime";
import { EVENT_DAYS_AHEAD } from "./view/start-form";
import { appendPlanEvents, getPlanMeta, loadPlanEvents, loadPlanReport, setPlanMeta } from "./store";
import type { PlanInputs } from "./schema";

const LIVE = { STOOP_LIVE: "true", LIVE_RUNS_DAILY_CAP: "30" };
const inputs: PlanInputs = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];
const visitor = "v_0123456789abcdef01234567" as VisitorId;
const ctxFor = (store: MemoryStore): RequestContext => ({ store, visitor, source: "web" });
const RUN_ID = "plan_0123456789abcdef01234567";

function startDeps(env: Record<string, string> = LIVE) {
  const scheduled: (() => Promise<void>)[] = [];
  let n = 0;
  const deps: PlanStartDeps = { env, schedule: (task) => scheduled.push(task), execute: async () => {}, randomHex: () => String(++n).padStart(24, "0") };
  return { deps, scheduled };
}

describe("starting a plan", () => {
  it("answers with the same city's example when live plans are off", async () => {
    const { deps, scheduled } = startDeps({ STOOP_LIVE: "false" });
    const reply = await startPlan(deps, { inputs }, ctxFor(new MemoryStore()));
    expect(reply).toMatchObject({ mode: "example", slug: "chicago-18th-street", id: "ex-chicago-18th-street", reason: "replay" });
    expect(scheduled).toHaveLength(0);
    expect(exampleFor({ ...inputs, store: { ...inputs.store, city: "Boise" } })).toBe("chicago-18th-street");
  });

  it("starts once, and a repeat of the same inputs joins it", async () => {
    const store = new MemoryStore();
    const { deps, scheduled } = startDeps();
    const first = await startPlan(deps, { inputs }, ctxFor(store));
    expect(first).toMatchObject({ mode: "live", joined: false, id: "plan_000000000000000000000001" });
    expect(scheduled).toHaveLength(1);
    expect((await getPlanMeta(store, "plan_000000000000000000000001"))?.status).toBe("running");
    expect(await store.get(keys.planInput("plan_000000000000000000000001"))).toEqual(inputs);
    const again = await startPlan(deps, { inputs }, ctxFor(store));
    expect(again).toMatchObject({ mode: "live", joined: true, id: "plan_000000000000000000000001" });
    expect(scheduled).toHaveLength(1);
  });

  it("replays an example when today's live runs are spent", async () => {
    const store = new MemoryStore();
    const { deps } = startDeps({ ...LIVE, LIVE_RUNS_DAILY_CAP: "0" });
    expect(await startPlan(deps, { inputs }, ctxFor(store))).toMatchObject({ mode: "example", reason: "daily-cap" });
  });

  it("refuses notes that break the guard, before anything starts", async () => {
    const { deps } = startDeps();
    await expect(startPlan(deps, { inputs: { ...inputs, notes: "Free beer for everyone" } }, ctxFor(new MemoryStore()))).rejects.toMatchObject({ status: 422 });
  });

  it("refuses an offer or a store name that would post alcohol, a link or an endorsement, before anything starts", async () => {
    const { deps, scheduled } = startDeps();
    await expect(startPlan(deps, { inputs: { ...inputs, offers: [{ text: "Free beer with every port-in" }] } }, ctxFor(new MemoryStore()))).rejects.toMatchObject({ status: 422 });
    await expect(startPlan(deps, { inputs: { ...inputs, offers: [{ text: "Claim at bit.ly/deal" }] } }, ctxFor(new MemoryStore()))).rejects.toMatchObject({ status: 422 });
    await expect(startPlan(deps, { inputs: { ...inputs, store: { ...inputs.store, name: "Official Metro by T-Mobile Event" } } }, ctxFor(new MemoryStore()))).rejects.toMatchObject({ status: 422 });
    expect(scheduled).toHaveLength(0);
  });

  it("refuses inputs that break the contract", async () => {
    const { deps } = startDeps();
    await expect(startPlan(deps, { inputs: { ...inputs, ageBands: [] } }, ctxFor(new MemoryStore()))).rejects.toThrow();
  });
});

describe("the plan store", () => {
  const emit = createPlanEmitter(() => new Date("2026-10-28T12:00:00Z"));
  it("gives every writer its own seqs from the plan's counter", async () => {
    const store = new MemoryStore();
    const a = await appendPlanEvents(store, RUN_ID, [emit({ type: "plan.started", runId: RUN_ID, kind: "live", inputs }), emit({ type: "stage.started", stage: "store" })]);
    const b = await appendPlanEvents(store, RUN_ID, [createPlanEmitter()({ type: "local.gap", text: "No Qloo signal for parks" })]);
    expect([...a, ...b].map((e) => e.seq)).toEqual([0, 1, 2]);
    const report = await loadPlanReport(store, RUN_ID);
    expect(report?.meta).toMatchObject({ id: RUN_ID, kind: "live", provenance: "live" });
    expect(report?.local.gaps).toEqual(["No Qloo signal for parks"]);
    expect(await loadPlanReport(store, "plan_ffffffffffffffffffffffff")).toBeNull();
  });

  it("refreshes every key of a plan together on each write, so no part expires before the rest", async () => {
    let now = Date.parse("2026-10-29T12:00:00Z");
    const store = new MemoryStore({ now: () => now });
    const at = new Date(now).toISOString();
    await store.set(keys.planInput(RUN_ID), inputs, { ttlSeconds: 60 });
    await store.set(keys.planVariantB(RUN_ID), { conceptId: "b" }, { ttlSeconds: 60 });
    await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at });
    await store.expire(keys.planMeta(RUN_ID), 60);
    now += 30_000;
    await appendPlanEvents(store, RUN_ID, [emit({ type: "plan.started", runId: RUN_ID, kind: "live", inputs })]);
    now += 10 * 86_400_000;
    expect(await store.get(keys.planInput(RUN_ID))).toEqual(inputs);
    expect(await store.get(keys.planVariantB(RUN_ID))).toEqual({ conceptId: "b" });
    expect(await getPlanMeta(store, RUN_ID)).not.toBeNull();
    now += 40 * 86_400_000;
    expect(await store.get(keys.planInput(RUN_ID))).toBeNull();
  });

  it("refuses an event more than 4 weeks out, before anything is counted", async () => {
    const store = new MemoryStore();
    const { deps, scheduled } = startDeps();
    const far = { ...inputs, date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) };
    await expect(startPlan(deps, { inputs: far }, ctxFor(store))).rejects.toMatchObject({ field: "date", status: 400 });
    expect(scheduled).toHaveLength(0);
    expect(await store.get(keys.daily("live-runs"))).toBeNull();
  });
});

describeRecorded("examples in the store", () => {
  it("fold what was added after the recording in after its last seq", async () => {
    const store = new MemoryStore();
    const id = examplePlanId("chicago-18th-street");
    const recorded = await loadExampleEvents("chicago-18th-street");
    const poster = { status: "ready" as const, prompt: "p", promptHash: "h", url: "https://example.com/poster.png", alt: "A poster" };
    const [added] = await appendPlanEvents(store, id, [createPlanEmitter()({ type: "poster.updated", poster })]);
    expect(added?.seq).toBe(Math.max(...recorded.map((e) => e.seq)) + 1);
    expect((await loadPlanEvents(store, id)).length).toBe(recorded.length + 1);
    expect((await loadPlanReport(store, id))?.poster).toEqual(poster);
    // Without the store, the example is its recording alone (its approved poster, never the one added here).
    expect((await loadPlanReport(null, id))?.poster).toEqual(toPlanReport(reducePlan(recorded)).poster);
    expect((await loadPlanReport(null, id))?.poster).not.toEqual(poster);
  });

  it("run a live plan end to end in the background, from the recordings", async () => {
    const store = new MemoryStore();
    const at = new Date().toISOString();
    await store.set(keys.planInput(RUN_ID), inputs);
    await setPlanMeta(store, { runId: RUN_ID, status: "running", inputHash: "0".repeat(64), createdAt: at, updatedAt: at });
    const model = Object.assign(replayPlanModel("chicago-18th-street"), { modelId: "claude-sonnet-5-5" });
    await executePlan({ store, client: replayClient("chicago-18th-street"), model: model as never }, RUN_ID);
    expect((await getPlanMeta(store, RUN_ID))?.status).toBe("done");
    const events = await loadPlanEvents(store, RUN_ID);
    expect(events.at(-1)?.type).toBe("run.done");
    const report = await loadPlanReport(store, RUN_ID);
    expect(report?.plan?.concepts.length).toBeGreaterThan(0);
    expect(report?.cost?.qloo.live).toBe(0);
    expect(await store.leaseCount(keys.planLeases)).toBe(0);
  });
});

describeRecorded("the plan routes", () => {
  const deps: PlanRouteDeps = { store: () => new MemoryStore(), start: () => startDeps().deps };
  it("serve an example's report with no store at all", async () => {
    const response = await getPlan("ex-atlanta-west-end", { ...deps, store: () => { throw new Error("no store"); } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; report: { meta: { id: string } } };
    expect(body).toMatchObject({ status: "done", report: { meta: { id: "ex-atlanta-west-end" } } });
    expect((await getPlan("ex-nowhere", deps)).status).toBe(404);
  });

  it("stream an example's recording as plan events", async () => {
    const response = await getPlanEvents(new Request("http://localhost/api/plan/ex-houston-east-end/events"), "ex-houston-east-end", deps);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(value)).toMatch(/retry: 3000/);
  });
});

describe("logging results", () => {
  const body = { walkIns: 14, sales: 3, posted: { facebook: true, instagram: false, whatsapp: true } };
  const SECRET = "s".repeat(40);
  const owner = mintVisitorCookie(SECRET);
  const post = (id: string, store: MemoryStore, cookie: string | null = `${VISITOR_COOKIE}=${owner.value}`) =>
    postPlanResults(
      new Request(`http://localhost/api/plan/${id}/results`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } }),
      id,
      { env: { STOOP_SIGNING_SECRET: SECRET }, store: () => store, start: () => startDeps().deps, now: () => Date.parse("2026-11-07T22:00:00Z") },
    );

  it("keeps example plans read-only", async () => {
    expect((await post("ex-chicago-18th-street", new MemoryStore())).status).toBe(403);
  });

  it("refuses anyone but the browser that started the plan", async () => {
    const store = new MemoryStore();
    const at = new Date().toISOString();
    await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id });
    await appendPlanEvents(store, RUN_ID, [createPlanEmitter()({ type: "plan.started", runId: RUN_ID, kind: "live", inputs })]);
    expect((await post(RUN_ID, store, null)).status).toBe(403);
    expect((await post(RUN_ID, store, `${VISITOR_COOKIE}=${mintVisitorCookie(SECRET).value}`)).status).toBe(403);
    expect((await loadPlanReport(store, RUN_ID))?.results).toHaveLength(0);
  });

  it("adds a results.logged event to a live plan", async () => {
    const store = new MemoryStore();
    const at = new Date().toISOString();
    await setPlanMeta(store, { runId: RUN_ID, status: "done", inputHash: "0".repeat(64), createdAt: at, updatedAt: at, owner: owner.id });
    await appendPlanEvents(store, RUN_ID, [createPlanEmitter()({ type: "plan.started", runId: RUN_ID, kind: "live", inputs })]);
    const response = await post(RUN_ID, store);
    expect(response.status).toBe(200);
    const events: PlanEvent[] = await loadPlanEvents(store, RUN_ID);
    expect(events.at(-1)).toMatchObject({ type: "results.logged", seq: 1, results: { ...body, loggedAt: "2026-11-07T22:00:00.000Z" } });
    expect((await loadPlanReport(store, RUN_ID))?.results).toHaveLength(1);
    expect((await post("plan_ffffffffffffffffffffffff", store)).status).toBe(404);
  });
});

describe("the event date limit", () => {
  it("is the same in the form's date picker and on the server", () => {
    expect(EVENT_DAYS_AHEAD).toBe(MAX_EVENT_DAYS_AHEAD);
  });
});
