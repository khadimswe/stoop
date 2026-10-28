// Fixes from the Dallas and Fort Worth holdout (proof lab round 3): franchises found by their own
// description or by branches across stores, and a run whose Claude calls run out of time still
// ending with a plan. Every id and name here is made up.
import { describe, expect, it } from "vitest";
import { PLAN_BUDGET, PLAN_CAP } from "../qloo/budget";
import { createRunContext } from "../qloo/context";
import type { QlooEntity } from "../qloo/types";
import { writeConcepts } from "./concepts";
import { claudeTimeout, DEADLINE_RESERVE_MS, type PlanEnv } from "./env";
import { guardFor } from "./guard-context";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import type { Local, PlanInputs } from "./schema";
import { isChain, repeatedPlaceNames, toPlace } from "./taste";

const ID = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"] as const;
const place = (over: Partial<QlooEntity>): QlooEntity => ({ id: ID[1], name: "Quillon Cafe", type: "urn:entity:place", popularity: null, affinity: null, disambiguation: null, location: null, tags: [], explainability: null, properties: null, ...over });

describe("chains the name list misses", () => {
  it("reads Qloo's own description", () => {
    expect(toPlace(place({ properties: { short_description: "Family-friendly Texas-born chain serving comfort dishes." } }), { rank: 1, evidenceId: "ev_000000000001", fallback: "food" }).chain).toBe(true);
    expect(toPlace(place({ properties: { short_description: "Neighborhood pie shop with handmade pies." } }), { rank: 1, evidenceId: "ev_000000000001", fallback: "food" }).chain).toBe(false);
  });
  it("knows the franchises the holdout found by hand", () => {
    for (const name of ["kung fu tea", "cotton patch cafe", "beard papa's plano", "the original pancake house", "buttermilk sky pie shop"]) expect(isChain(name)).toBe(true);
  });
  it("counts branches by Qloo id, so one place two stores both see stays independent", () => {
    const one = { name: "Quillon Cafe", id: ID[1] };
    expect([...repeatedPlaceNames([{ places: [one] }, { places: [one] }])]).toEqual([]);
    expect([...repeatedPlaceNames([{ places: [one] }, { places: [{ name: "Quillon Cafe", id: ID[2] }] }])]).toEqual(["quillon cafe"]);
  });
  it("never marks a park by repetition", () => {
    const park = place({ name: "Zevrin Park", properties: { primary_genre: { id: "urn:tag:genre:place:park" } } });
    expect(toPlace(park, { rank: 1, evidenceId: "ev_000000000001", fallback: "park", knownChains: new Set(["zevrin park"]) }).chain).toBe(false);
  });
});

describe("Claude calls inside the run's deadline", () => {
  it("cuts a call to the time left, and skips it when too little is left", () => {
    const now = () => 1_000_000;
    expect(claudeTimeout({ now }, 120_000)).toBe(120_000);
    expect(claudeTimeout({ now, deadlineAt: 1_000_000 + DEADLINE_RESERVE_MS + 60_000 }, 120_000)).toBe(60_000);
    expect(claudeTimeout({ now, deadlineAt: 1_000_000 + DEADLINE_RESERVE_MS + 5_000 }, 120_000)).toBeNull();
  });

  it("ends with a plain concept from Qloo's lists when no time is left for Claude", async () => {
    const local: Local = {
      city: { city: "Quillon", ageBands: ["25_to_29"], styles: [], artists: [{ id: ID[0], name: "Zevrin", rank: 1, genres: ["Pop"], evidenceIds: ["ev_00000000000a"] }] },
      block: { radiusM: 1500, places: [{ id: ID[1], name: "Quillon Bakery", kind: "food", tags: [], address: null, distanceM: 300, why: null, rank: 1, affinity: null, popularity: null, chain: false, evidenceIds: ["ev_00000000000b"] }] },
      gaps: [],
    };
    const inputs: PlanInputs = { ...PLAN_EXAMPLE_INPUTS["chicago-18th-street"], date: "2026-10-31", offers: [{ text: "Free tablet with a new line" }] };
    const decisions: string[] = [];
    const model = new Proxy({}, { get: () => { throw new Error("Claude must not be called"); } }) as PlanEnv["model"];
    const env: PlanEnv = { client: {} as PlanEnv["client"], ctx: createRunContext({ runId: "plan_test", cap: PLAN_CAP, rowCaps: PLAN_BUDGET }), model, deadlineAt: 0, now: () => 1, sink: { emit: (e) => (e.type === "trace.step" && decisions.push(e.step.label), e as never) } };
    const outcome = await writeConcepts(env, inputs, local, guardFor(inputs, [ID[0], ID[1]], ["Zevrin", "Quillon Bakery"]));
    expect(outcome?.concepts).toHaveLength(1);
    const [concept] = outcome!.concepts;
    expect(concept).toMatchObject({ kept: true, title: "Halloween Saturday Wheel Spin" });
    expect(concept!.items.map((i) => i.kind)).toEqual(["theme", "music", "food", "giveaway", "signage", "timing"]);
    expect(concept!.items.find((i) => i.kind === "giveaway")?.evidenceIds).toEqual(["ev_00000000000b"]);
    expect(decisions).toContain("Built a plain concept from Qloo's own lists");
  });
});
