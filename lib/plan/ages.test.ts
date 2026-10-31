// "Who loves these spots": the bands' labels (the youngest always reads 18 to 24), the signal's
// places, Qloo's rows read as mean age skews (gender never read), and the route's fail-closed paths
// (204 whenever there is no answer, never a 500). Qloo rows come from fixtures/ only; nothing here is
// hand-written Qloo data, and no Qloo entity name appears in this file.
import { describe, expect, it } from "vitest";
import { allowAll } from "../bot-check";
import { createQlooClient, type QlooClient } from "../qloo/client";
import { FixtureCache, findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { demographicsResponse } from "../qloo/types";
import { dayOf, keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { describeRecorded, ifRecorded } from "../testing/recorded";
import { agesCacheKey, askAges, bandSkews, getPlanAges, signalPlaces, topBands, AGES_SIGNAL_MAX, type AgesDeps } from "./ages";
import { loadPlanReport } from "./store";
import { AGE_BANDS, agesLine, agesViewOf, skewText, topLabel } from "./view/ages";

const probe = ifRecorded(() => {
  const file = findFixture("kids-probe-2");
  if (!file) throw new Error("fixture kids-probe-2 is missing");
  return readFixtureFile(file);
});
const DEMOGRAPHICS = "demographics-kids-titles";
const recordedIds = () => String(recorded(probe, DEMOGRAPHICS).params["signal.interests.entities"]).split(",");
const recordedRows = () => demographicsResponse.parse(recorded(probe, DEMOGRAPHICS).body);
const fixtureClient = () => createQlooClient({ cache: new FixtureCache([probe], { strict: true }) });
const emptyClient = () => createQlooClient({ cache: new FixtureCache([], { strict: true }) });
const noQloo = (): QlooClient => {
  throw new Error("no Qloo in this test");
};

describe("age band labels", () => {
  it("shows Qloo's youngest bucket as 18 to 24, never its own name", () => {
    expect(AGE_BANDS[0]).toMatchObject({ bucket: "24_and_younger", label: "18 to 24" });
    expect(topLabel(["24_and_younger"])).toBe("18 to 24");
    expect(AGE_BANDS.map((b) => b.label).join(" ")).not.toMatch(/younger|_/);
  });

  it("joins two bands that touch and lists two that do not", () => {
    expect(topLabel(["25_to_29", "30_to_34"])).toBe("25 to 34");
    expect(topLabel(["30_to_34", "25_to_29"])).toBe("25 to 34");
    expect(topLabel(["24_and_younger", "25_to_29"])).toBe("18 to 29");
    expect(topLabel(["45_to_54", "55_and_older"])).toBe("45 and older");
    expect(topLabel(["24_and_younger", "45_to_54"])).toBe("18 to 24 and 45 to 54");
    expect(topLabel([])).toBe("");
  });

  it("says skew, never a share, and never the store's buyers", () => {
    const line = agesLine("25 to 34");
    expect(line).toBe("People who love the spots near your store skew 25 to 34");
    expect(agesLine("25 to 34", "the event")).toContain("near the event");
    expect(line).not.toMatch(/%|customer|buyer/i);
    expect([skewText(0.214), skewText(-0.05), skewText(0.001)]).toEqual(["+0.21", "-0.05", "0.00"]);
  });

  it("checks the route's answer and shows nothing for anything else", () => {
    for (const body of [null, "", {}, { top: "", bands: [], spots: 0 }, { top: "25 to 34", spots: 3, bands: [{ bucket: "under_18", skew: 0.2 }] }]) expect(agesViewOf(body)).toBeNull();
    const receipt = { cue: "Who loves these spots", title: "t", calls: 1, rows: [{ label: "Endpoint", value: "/v2/insights", mono: true }] };
    expect(agesViewOf({ top: "25 to 34", spots: 3, bands: [{ bucket: "25_to_29", skew: 1.4 }], receipt })).toBeNull();
    // Stoop's own label wins over whatever the body says.
    const view = agesViewOf({ top: "18 to 24", spots: 3, bands: [{ bucket: "24_and_younger", label: "24 and younger", skew: 0.3 }], receipt });
    expect(view?.bands[0]?.label).toBe("18 to 24");
  });
});

describe("the signal's places", () => {
  it("takes non-chain food spots and venues first, by Qloo rank, then the rest, then chains", () => {
    const places = [
      { id: "a", kind: "park", rank: 1 },
      { id: "b", kind: "food", rank: 4, chain: true },
      { id: "c", kind: "food", rank: 3 },
      { id: "d", kind: "venue", rank: 2 },
      { id: "e", kind: "shop", rank: 5 },
    ] as const;
    expect(signalPlaces(places)).toEqual(["d", "c", "a", "e", "b"]);
    expect(signalPlaces(places, 2)).toEqual(["d", "c"]);
    expect(signalPlaces([])).toEqual([]);
  });
});

describeRecorded("against recorded Qloo data", () => {
  it("picks at most 8 places from a recorded community, never a chain ahead of an independent", async () => {
    const report = await loadPlanReport(null, "ex-chicago-18th-street");
    const places = report!.local.block!.places;
    const ids = signalPlaces(places);
    expect(ids.length).toBe(Math.min(AGES_SIGNAL_MAX, places.length));
    const picked = ids.map((id) => places.find((p) => p.id === id)!);
    const firstChain = picked.findIndex((p) => p.chain);
    if (firstChain >= 0) expect(picked.slice(firstChain).every((p) => p.chain)).toBe(true);
    const independents = places.filter((p) => !p.chain && (p.kind === "food" || p.kind === "venue"));
    expect(picked.slice(0, Math.min(independents.length, AGES_SIGNAL_MAX)).every((p) => !p.chain && (p.kind === "food" || p.kind === "venue"))).toBe(true);
  });

  it("reads each band's mean skew across Qloo's rows, adult labels only, gender never", () => {
    const rows = recordedRows();
    const bands = bandSkews(rows);
    expect(bands.map((b) => b.bucket)).toEqual(AGE_BANDS.map((b) => b.bucket));
    expect(bands[0]!.label).toBe("18 to 24");
    for (const band of bands) {
      const values = rows.map((r) => r.age[band.bucket]!);
      expect(band.skew).toBeCloseTo(values.reduce((s, v) => s + v, 0) / values.length, 2);
      expect(Math.abs(band.skew)).toBeLessThanOrEqual(1);
    }
    expect(JSON.stringify(bands)).not.toMatch(/male|female|gender/);
    const top = topBands(bands);
    expect(top.length).toBeGreaterThan(0);
    expect(top.length).toBeLessThanOrEqual(2);
    for (const bucket of top) expect(bands.find((b) => b.bucket === bucket)!.skew).toBeGreaterThan(0);
  });

  it("asks Qloo once, through the client, and returns the bands with their receipt", async () => {
    const view = await askAges(fixtureClient(), recordedIds(), { runId: "ages_test" });
    expect(view).not.toBeNull();
    expect(view!.spots).toBe(recordedIds().length);
    expect(view!.top).toBe(topLabel(topBands(view!.bands)));
    expect(view!.receipt.rows).toContainEqual({ label: "Endpoint", value: "/v2/insights", mono: true });
    expect(view!.receipt.rows).toContainEqual({ label: "Asked for", value: "urn:demographics", mono: true });
    expect(agesViewOf(JSON.parse(JSON.stringify(view)))).toEqual(view);
  });
});

const ask = (id: string, headers: Record<string, string> = {}) => new Request(`https://stoop.example/api/plan/${id}/ages`, { headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": "203.0.113.9", ...headers } });
const deps = (store: MemoryStore, over: Partial<AgesDeps> = {}): AgesDeps => ({ live: true, store: () => store, botCheck: () => allowAll, client: noQloo, env: { QLOO_DAILY_CAP: "500" }, ...over });

describe("GET /api/plan/[id]/ages, when there is no answer", () => {
  it("answers 204 with live calls off, without asking Qloo", async () => {
    const response = await getPlanAges(ask("ex-chicago-18th-street"), "ex-chicago-18th-street", deps(new MemoryStore(), { live: false }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("answers 204 for an id that is not a plan, and for a live plan nobody started", async () => {
    expect((await getPlanAges(ask("nope"), "nope", deps(new MemoryStore()))).status).toBe(204);
    expect((await getPlanAges(ask("plan_000000000000000000000000"), "plan_000000000000000000000000", deps(new MemoryStore()))).status).toBe(204);
  });

  it("answers 204, not 500, when the shared store is down", async () => {
    const down = () => {
      throw new Error("no store");
    };
    expect((await getPlanAges(ask("ex-chicago-18th-street"), "ex-chicago-18th-street", { ...deps(new MemoryStore()), store: down })).status).toBe(204);
  });

  it("keeps an honest 403 for another site's request", async () => {
    expect((await getPlanAges(ask("ex-chicago-18th-street", { "sec-fetch-site": "cross-site" }), "ex-chicago-18th-street", deps(new MemoryStore()))).status).toBe(403);
  });
});

describeRecorded("GET /api/plan/[id]/ages on a recorded example", () => {
  const id = "ex-chicago-18th-street";

  it("answers 204 when Qloo throws (no key), when nothing was recorded, and when today's cap is spent", async () => {
    expect((await getPlanAges(ask(id), id, deps(new MemoryStore()))).status).toBe(204);
    expect((await getPlanAges(ask(id), id, deps(new MemoryStore(), { client: emptyClient }))).status).toBe(204);
    const capped = new MemoryStore();
    await capped.incr(keys.daily("qloo", dayOf()), { by: 500 });
    let asked = false;
    const watch = (): QlooClient => {
      asked = true;
      return noQloo();
    };
    expect((await getPlanAges(ask(id), id, deps(capped, { client: watch }))).status).toBe(204);
    expect(asked).toBe(false);
  });

  it("answers 204 when Qloo is slow", async () => {
    const slow = (): QlooClient => ({ request: () => new Promise(() => {}), raw: () => new Promise(() => {}) });
    expect((await getPlanAges(ask(id), id, deps(new MemoryStore(), { client: slow, timeoutMs: 20 }))).status).toBe(204);
  });

  it("serves a kept answer for the same places without asking Qloo", async () => {
    const store = new MemoryStore();
    const view = await askAges(fixtureClient(), recordedIds(), { runId: "ages_test" });
    const report = await loadPlanReport(null, id);
    await store.set(agesCacheKey(signalPlaces(report!.local.block!.places)), view);
    const response = await getPlanAges(ask(id), id, deps(store));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(view);
  });
});
