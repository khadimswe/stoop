import { describe, expect, it } from "vitest";
import { dayContext, holidays } from "./calendar";
import { checkConcepts, conceptIds, notesMissing, toConcepts, type CheckedConcept } from "./concepts";
import { guardFor } from "./pipeline";
import { buildAliases } from "./prompt";
import { bounded, pickKept, PLAN_MAX_TOTAL, planTotal, specificityCap, type PlanScore } from "./rubric";
import type { Local, PlanInputs } from "./schema";

const score = (over: Partial<PlanScore["scores"]> = {}, noStereotype = true): PlanScore => ({
  scores: { walk_ins: 3, stops_people: 3, specificity: 3, fits_day: 3, feasibility: 3, ...over },
  noStereotype,
});

describe("the event rubric", () => {
  it("counts bringing people inside double", () => {
    expect(PLAN_MAX_TOTAL).toBe(30);
    expect(planTotal(score({ walk_ins: 5 }))).toBe(planTotal(score()) + 4);
  });
  it("caps specificity by the distinct Qloo items a concept uses", () => {
    expect(specificityCap(0)).toBe(2);
    expect(specificityCap(1)).toBe(3);
    expect(specificityCap(9)).toBe(5);
    expect(bounded(score({ specificity: 5 }), 0).scores.specificity).toBe(2);
    expect(bounded(score({ specificity: 7 }), 5).scores.specificity).toBe(5);
  });
  it("keeps the best concept that passes the gate, ties going to walk-ins, then specificity, then order", () => {
    const a = { name: "a", score: score({ walk_ins: 4, specificity: 2 }) };
    const b = { name: "b", score: score({ walk_ins: 3, specificity: 4 }) };
    const c = { name: "c", score: score({ walk_ins: 5, stops_people: 5 }, false) };
    expect(pickKept([a, b])?.name).toBe("a");
    expect(pickKept([c])).toBeNull();
    expect(pickKept([b, { ...b, name: "b2" }])?.name).toBe("b");
  });
});

describe("the day", () => {
  it("knows the holidays that move foot traffic", () => {
    const days = holidays(2026);
    expect(days.find((h) => h.name === "Thanksgiving")?.date).toBe("2026-11-26");
    expect(days.find((h) => h.name === "Small Business Saturday")?.date).toBe("2026-11-28");
    expect(days.find((h) => h.name === "Memorial Day")?.date).toBe("2026-05-25");
  });
  it("reads Halloween, paydays and the season from the date alone", () => {
    const halloween = dayContext("2026-10-31");
    expect(halloween.label).toBe("Saturday, October 31, 2026");
    expect(halloween.notes.join(" ")).toMatch(/It is Halloween/);
    expect(dayContext("2026-11-14").hints.join(" ")).toMatch(/mid-month/);
    expect(dayContext("2026-11-06").hints.join(" ")).toMatch(/Friday, a common payday/);
    expect(dayContext("2026-11-06").notes.join(" ")).not.toMatch(/payday/);
    expect(dayContext("2026-11-07").notes.join(" ")).toMatch(/Veterans Day is in 4 days/);
    expect(dayContext("2027-03-06").notes.join(" ")).toMatch(/tax refund season/);
  });
});

const ARTIST = "00000000-0000-4000-8000-000000000001";
const PLACE = "00000000-0000-4000-8000-000000000002";
const CHAIN = "00000000-0000-4000-8000-000000000003";
const local: Local = {
  city: { city: "Chicago", ageBands: ["25_to_29"], artists: [{ id: ARTIST, name: "Zevrin", rank: 1, genres: ["Hip Hop"], evidenceIds: ["ev_00000000000a"] }], styles: [{ tagId: "urn:tag:genre:qloo:hip_hop", name: "Hip Hop", evidenceIds: ["ev_00000000000a"] }] },
  block: {
    radiusM: 1500,
    places: [
      { id: PLACE, name: "Quillon Smokehouse", kind: "food", tags: [], address: null, distanceM: 26, why: null, rank: 1, affinity: null, popularity: null, evidenceIds: ["ev_00000000000b"] },
      { id: CHAIN, name: "costco", kind: "shop", tags: [], address: null, distanceM: 1054, why: null, rank: 2, affinity: null, popularity: null, chain: true, evidenceIds: ["ev_00000000000b"] },
    ],
  },
  gaps: [],
};
const inputs = { offers: [{ text: "Free tablet with a new line" }], budgetUsd: 150, notes: "Small gift cards please" } as PlanInputs;
const guard = guardFor(inputs, [ARTIST, PLACE, CHAIN], ["Zevrin", "Quillon Smokehouse", "costco"]);
const aliases = buildAliases(local);

describe("concept checks", () => {
  const concept = (items: { kind: string; text: string; origin: string; styles?: string[] }[]) => ({
    concepts: [
      {
        title: "Warm Plate Saturday",
        hook: "Hot food on a cold block.",
        items: items.map((i) => ({ styles: [], ...i })),
        scores: { walk_ins: 4, stops_people: 4, specificity: 5, fits_day: 3, feasibility: 4 },
        noStereotype: true,
        note: "Depends on one kitchen.",
      },
    ],
  }) as Parameters<typeof checkConcepts>[0];

  it("swaps keys for Qloo ids and takes receipts from what the refs and styles point at", () => {
    const check = checkConcepts(concept([
      { kind: "food", text: "Sliders from [[p1]], 30 m away.", origin: "qloo" },
      { kind: "music", text: "A playlist led by [[a1]].", origin: "interpreted", styles: ["s1"] },
      { kind: "giveaway", text: "A free drawing for a $10 gift card to [[p1]].", origin: "qloo" },
      { kind: "signage", text: 'Sign: "Free tablet with a new line"', origin: "yours" },
    ]), aliases, guard);
    const [first] = check.concepts as [CheckedConcept];
    expect(first.items[0]).toMatchObject({ text: `Sliders from [[${PLACE}]], 30 m away.`, refs: [PLACE], evidenceIds: ["ev_00000000000b"] });
    expect(first.items[1]?.evidenceIds).toEqual(["ev_00000000000a"]);
    expect(first.qlooItems).toBe(3);
    expect(check.issues.filter((i) => !i.startsWith("concepts:"))).toEqual([]);
  });

  it("drops lines that fail and says why, for the repair", () => {
    const check = checkConcepts(concept([
      { kind: "partner", text: "Co-promo with [[p2]].", origin: "qloo" },
      { kind: "music", text: "Play Zevrin all day.", origin: "creative" },
      { kind: "food", text: "Tacos from [[p9]].", origin: "qloo" },
    ]), aliases, guard);
    const issues = check.issues.join("\n");
    expect(issues).toMatch(/national chain is not a co-promo partner/);
    expect(issues).toMatch(/written out/);
    expect(issues).toMatch(/\[\[p9\]\] is not an artist or place/);
    expect(issues).toMatch(/notes ask for gift cards/);
    expect(check.concepts[0]?.items).toEqual([]);
  });

  it("finds what the manager's notes ask for and a concept leaves out", () => {
    expect(notesMissing("Snacks not catering, and small gift cards", [{ text: "Hot coffee from the cafe." }])).toEqual(["gift cards", "snacks"]);
    expect(notesMissing("", [{ text: "anything" }])).toEqual([]);
  });

  it("scores, caps and keeps one concept, with a note on the others", () => {
    const item = { kind: "food" as const, text: "x", origin: "creative" as const, refs: [], evidenceIds: [] };
    const concepts = toConcepts([
      { title: "A plan", hook: "h", items: [item, item, item], score: score({ walk_ins: 5, specificity: 5 }), note: "Weak spot.", qlooItems: 0 },
      { title: "A plan", hook: "h", items: [item, item, item], score: score({ walk_ins: 4 }), note: "Other.", qlooItems: 2 },
    ]);
    expect(concepts.map((c) => c.id)).toEqual(["a-plan", "a-plan-2"]);
    expect(concepts.filter((c) => c.kept)).toHaveLength(1);
    expect(concepts[0]?.scores.find((s) => s.criterion === "Specificity")?.score).toBe(2);
    expect(concepts.find((c) => !c.kept)?.note).toMatch(/^Scored \d+ of 30/);
    expect(conceptIds(["", ""])).toEqual(["concept-1", "concept-2"]);
  });
});
