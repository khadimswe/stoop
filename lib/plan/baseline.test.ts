import { describe, expect, it } from "vitest";
import { PLAN_BUDGET, PLAN_CAP, PLAN_PLANNED_CALLS } from "../qloo/budget";
import { createQlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { QlooBudgetError } from "../qloo/errors";
import { checkPicks, compare, flagCliches, genericCliches, MIN_MEDIAN_N } from "./baseline";
import type { PlanEnv } from "./env";
import type { PlanEvent } from "./events";
import { pickSearchParams } from "./requests";
import type { Baseline, CityTaste, Concept, PlanInputs } from "./schema";
import { ENDPOINTS } from "../qloo/constants";
import { searchResponse } from "../qloo/types";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const inputs = { store: { city: "Chicago" }, ageBands: ["25_to_29"] } as unknown as PlanInputs;

/** A Qloo client over a fake fetch: /search finds the asked name, insights scores every id it is sent. */
function fakeEnv(scores: Record<string, number>, options: { caps?: Record<string, number> } = {}) {
  const fetch = async (url: string | URL | Request) => {
    const u = new URL(String(url));
    let body: unknown;
    if (u.pathname === "/search") {
      const query = u.searchParams.get("query") ?? "";
      body = { results: query === "Nobody Known" ? [] : [{ entity_id: id(900 + query.length), name: query, subtype: "urn:entity:artist" }] };
    } else {
      const ids = (u.searchParams.get("filter.results.entities") ?? "").split(",");
      body = { results: { entities: ids.filter((e) => scores[e] !== undefined).map((e) => ({ entity_id: e, name: e, subtype: "urn:entity:artist", query: { affinity: scores[e] } })) } };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = createQlooClient({ apiKey: "test-key", fetch: fetch as typeof globalThis.fetch, sleep: async () => {} });
  const ctx = createRunContext({ runId: "plan_test", cap: PLAN_CAP, rowCaps: options.caps ?? PLAN_BUDGET });
  const events: unknown[] = [];
  const env: PlanEnv = { client, ctx, model: {} as PlanEnv["model"], sink: { emit: (e) => (events.push(e), e as PlanEvent) } };
  return { env, ctx, events };
}

const city = (n: number): CityTaste => ({ city: "Chicago", ageBands: ["25_to_29"], styles: [], artists: Array.from({ length: n }, (_, i) => ({ id: id(i + 1), name: `Artist ${i + 1}`, rank: i + 1, genres: [], evidenceIds: ["ev_00000000000a"] })) });

describe("Qloo's check of the generic plan's picks", () => {
  it("scores resolved artists in one call next to Qloo's own and counts those below the median", async () => {
    const own = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [id(i + 1), 0.9 + i * 0.01]));
    const high = id(900 + "High Pick".length);
    const low = id(900 + "Low".length);
    const { env, ctx } = fakeEnv({ ...own, [high]: 0.99, [low]: 0.5 });
    const result = await checkPicks(env, inputs, city(6), { artists: ["High Pick", "Low", "Nobody Known"], foods: ["Some Chain"] });
    expect(result?.check).toMatchObject({ checkable: 2, belowMedian: 1, unverifiable: 2 });
    // Three searches and one scoring call; the food brand needs no call.
    expect(ctx.rowCalls).toEqual({ planResolve: 3, planScoring: 1 });
  });

  it("counts a pick with no score in the call as below the median (no measurable affinity)", async () => {
    const own = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [id(i + 1), 0.9]));
    const { env } = fakeEnv(own);
    const result = await checkPicks(env, inputs, city(5), { artists: ["Missing Artist"], foods: [] });
    expect(result?.check).toMatchObject({ checkable: 1, belowMedian: 1 });
    expect(result?.lines[0]).toMatch(/no measurable affinity/);
  });

  it(`has no median with fewer than ${MIN_MEDIAN_N} of Qloo's own artists: the picks are unverifiable`, async () => {
    const { env, ctx } = fakeEnv({});
    const result = await checkPicks(env, inputs, city(MIN_MEDIAN_N - 1), { artists: ["Someone"], foods: [] });
    expect(result?.check).toMatchObject({ checkable: 0, belowMedian: 0, unverifiable: 1 });
    expect(ctx.rowCalls.planScoring ?? 0).toBe(0);
  });
});

describe("the plan budget", () => {
  it("plans fewer calls than its hard cap, with room for retries", () => {
    expect(PLAN_PLANNED_CALLS).toBe(12);
    expect(PLAN_PLANNED_CALLS).toBeLessThan(PLAN_CAP);
  });
  it("refuses a call once its row is spent", async () => {
    const { env } = fakeEnv({}, { caps: { ...PLAN_BUDGET, planResolve: 1 } });
    const search = (name: string) => env.client.request(env.ctx, { endpoint: ENDPOINTS.search, params: pickSearchParams(name, "artist"), schema: searchResponse, budgetRow: "planResolve" });
    await search("First");
    await expect(search("Second")).rejects.toBeInstanceOf(QlooBudgetError);
  });
});

describe("cliches and the side by side", () => {
  const items = [
    { kind: "setup" as const, text: "Balloons tied to the table and a DJ playing top 40." },
    { kind: "music" as const, text: "A mix of the city's classic soul." },
    { kind: "signage" as const, text: 'A sign: "Free phone when you switch" next to a prize wheel and a free drawing.' },
  ];
  it("flags choices with no local signal, never the store's proven tactics", () => {
    const flagged = flagCliches(items).map((c) => c.text);
    expect(flagged).toEqual(expect.arrayContaining(["Balloons", "A DJ", "A playlist of popular hits"]));
    expect(flagged.join(" ")).not.toMatch(/phone|wheel|raffle|drawing/i);
  });
  it("flags a plan with no place from this block, and music Qloo does not back", () => {
    const check = { checkable: 3, belowMedian: 2, unverifiable: 0, evidenceIds: [] };
    expect(genericCliches(items, check, ["Quillon Hall"], "Chicago").map((c) => c.text)).toEqual(["No place on this block", "Music with no local signal"]);
    expect(genericCliches(items, { ...check, belowMedian: 1 }, ["Quillon Hall"], "Chicago").map((c) => c.text)).toEqual(["No place on this block"]);
    expect(genericCliches([{ kind: "food", text: "Snacks from Quillon Hall" }], null, ["Quillon Hall"], "Chicago")).toEqual([]);
  });
  it("says what the plan uses on this block and what Qloo found in the generic plan", () => {
    const place = id(7);
    const kept = { id: "k", title: "t", hook: "h", items: [{ kind: "food", text: `Sliders from [[${place}]]`, origin: "qloo", refs: [place], evidenceIds: ["ev_00000000000b"] }, { kind: "setup", text: "A table.", origin: "creative", refs: [], evidenceIds: [] }], scores: [], total: 20, kept: true } as Concept;
    const baseline = { items: [], cliches: [{ text: "Balloons", why: "w" }], check: { checkable: 3, belowMedian: 3, unverifiable: 2, evidenceIds: [] } } as Baseline;
    const block = { radiusM: 1500, places: [{ id: place, name: "Quillon Smokehouse", kind: "food" as const, tags: [], address: null, distanceM: 26, why: null, rank: 1, affinity: null, popularity: null, evidenceIds: ["ev_00000000000b"] }] };
    const comparison = compare({ kept, plan: { runOfShow: [], shopping: [{ item: "Sliders", estUsd: 60, from: place, origin: "interpreted", evidenceIds: [] }] }, baseline, block, city: "Chicago", where: "the store" });
    expect(comparison.qlooBacked).toEqual({ items: 1, of: 2 });
    expect(comparison.lines[0]).toBe("Buys from 1 place on this block, 30 m from the store; the generic plan names no place on this block.");
    expect(comparison.lines.join(" ")).toMatch(/3 of 3 checkable artists sit below the median/);
    expect(comparison.baselineCliches).toBe(1);
  });
});
