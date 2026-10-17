import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reportResponseSchema } from "../api/responses";
import type { ExampleSlug } from "../demo/examples";
import type { RunEvent } from "../events";
import type { Report } from "../report/schema";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { appendRunEvents, runLease, setRunMeta, type RunMeta } from "../store/runs";
import type { Store } from "../store/types";
import { getEvents, getHealth, getReport, getSearch, postIntake, postResume, postRun, type RouteDeps } from "./routes";

const slug = "food-hot-sauce";
const events = JSON.parse(readFileSync(`data/runs/${slug}/run.events.json`, "utf8")) as RunEvent[];
const report = JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const runId = `run_${"f".repeat(24)}`;
const at = "2026-10-17T12:00:00.000Z";
const meta: RunMeta = { runId, attempt: 1, status: "running", briefHash: "a".repeat(64), createdAt: at, updatedAt: at };

/** Route deps whose store throws when asked for, as on Vercel with no Upstash keys. */
function deps(env: Record<string, string>, store?: Store): RouteDeps {
  const fail = () => {
    throw new Error("No shared store is configured: the in-memory store is for local use only.");
  };
  return {
    env,
    store: store ? () => store : fail,
    start: () => ({ execute: async () => undefined, schedule: () => undefined }),
    intake: fail,
    search: fail,
    examples: {
      slug: (id) => (id === `example-${slug}` ? (slug as ExampleSlug) : null),
      events: async () => events,
      report: async () => report,
    },
  };
}

const post = (body: unknown) => new Request("http://localhost/api/run", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const start = { intakeId: `in_${"1".repeat(24)}`, seedIds: ["a", "b"], statedCustomer: null, region: "United States" };

describe("the runtime routes in replay mode (no store at all)", () => {
  const replay = deps({ VERCEL: "1" });

  it("answers a start and a resume with the lead example", async () => {
    const run = await postRun(post(start), replay);
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ mode: "example", reason: "replay" });
    expect(await (await postResume(post({}), runId, replay)).json()).toMatchObject({ mode: "example", reason: "replay" });
  });

  it("answers intake and search with the off message, not an error", async () => {
    const intake = await postIntake(post({ description: "A fermented red chile hot sauce in small batches." }), replay);
    expect(intake.status).toBe(503);
    expect(await intake.json()).toMatchObject({ error: { code: "off" } });
    const search = await getSearch(new Request(`http://localhost/api/search?intakeId=in_${"1".repeat(24)}&q=Hot%20Ones&type=tv_show`), replay);
    expect(await search.json()).toMatchObject({ error: { code: "off" } });
  });

  it("still checks what was sent", async () => {
    const bad = await postRun(post({ ...start, seedIds: ["only-one"] }), replay);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid" } });
    expect((await postResume(post({}), "not-a-run", replay)).status).toBe(400);
  });

  it("serves the examples' reports and traces from disk", async () => {
    const res = await getReport(`example-${slug}`, replay);
    expect(reportResponseSchema.parse(await res.json())).toMatchObject({ status: "done", eventsUrl: null });
    const stream = await getEvents(new Request(`http://localhost/api/run/example-${slug}/events`, { headers: { "Last-Event-ID": `1:${events.length - 3}` } }), `example-${slug}`, replay);
    expect(stream.headers.get("Content-Type")).toMatch(/text\/event-stream/);
    expect((await stream.text()).match(/^event: run$/gm)).toHaveLength(2);
    const caughtUp = await getEvents(new Request(`http://localhost/api/run/example-${slug}/events`, { headers: { "Last-Event-ID": `1:${events.at(-1)!.seq}` } }), `example-${slug}`, replay);
    expect(caughtUp.status).toBe(204);
  });

  it("refuses a start or an intake the bot check flags, before anything is spent", async () => {
    const store = new MemoryStore();
    const flagged = { ...deps({ STOOP_LIVE: "true" }, store), botCheck: () => ({ name: "test", check: async () => ({ bot: true }) }) };
    const run = await postRun(post(start), flagged);
    expect(run.status).toBe(403);
    expect(await run.json()).toMatchObject({ error: { code: "bot" } });
    expect((await postIntake(post({ description: "A fermented red chile hot sauce in small batches." }), flagged)).status).toBe(403);
    expect(await store.get(keys.daily("live-runs"))).toBeNull();
  });

  it("reports an unreachable store in health, with no secrets", async () => {
    const res = await getHealth(replay);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, live: false, store: "unreachable" });
  });
});

describe("the runtime routes with a store", () => {
  it("tells a viewer a run whose instance died can be resumed", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, meta);
    const res = await getReport(runId, deps({ STOOP_LIVE: "true" }, store));
    expect(await res.json()).toEqual({ status: "running", runId, eventsUrl: `/api/run/${runId}/events`, resumable: true });
    await store.leaseAcquire(keys.liveLeases, runLease(runId, 1), { max: 2, ttlMs: 60_000 });
    expect(await (await getReport(runId, deps({ STOOP_LIVE: "true" }, store))).json()).toMatchObject({ resumable: false });
  });

  it("answers 204 to a viewer reconnecting to an ended run it has already read, and 404 to an expired one", async () => {
    const store = new MemoryStore();
    await setRunMeta(store, { ...meta, status: "done" });
    const written = await appendRunEvents(store, runId, 1, [{ type: "run.done" }]);
    const reconnect = (id: string) => getEvents(new Request(`http://localhost/api/run/${runId}/events`, { headers: { "Last-Event-ID": id } }), runId, deps({}, store));
    expect((await reconnect(`1:${written[0].seq}`)).status).toBe(204);
    expect((await getEvents(new Request(`http://localhost/api/run/${"run_" + "0".repeat(24)}/events`), `run_${"0".repeat(24)}`, deps({}, store))).status).toBe(404);
  });

  it("shows today's caps and the store kind in health", async () => {
    const store = new MemoryStore();
    await store.incr(keys.daily("live-runs"), { by: 3 });
    const body = await (await getHealth(deps({ STOOP_LIVE: "true", LIVE_RUNS_DAILY_CAP: "10" }, store))).json();
    expect(body).toMatchObject({ ok: true, live: true, store: "memory", caps: { liveRuns: { used: 3, cap: 10 } } });
  });
});
