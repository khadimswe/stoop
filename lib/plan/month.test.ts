import { describe, expect, it } from "vitest";
import { describeRecorded } from "../testing/recorded";
import { PLAN_EXAMPLE_INPUTS } from "./example-list";
import { loadExampleReport } from "./examples";
import { planMonth, saturdaysFrom } from "./month";
import { abTestSchema, type Concept } from "./schema";
import { buildAbTest, TEST_CAVEAT } from "./test-plan";
import { checkWheel, labelFromPromo, wheelWanted } from "./wheel";
import { buildAliases } from "./prompt";
import { guardFor } from "./guard-context";
import { fitBudget } from "./builder";

const concept = (id: string, total: number, kept = false): Concept => ({ id, title: `Concept ${id}`, hook: "h", items: [{ kind: "theme", text: "t", origin: "creative", refs: [], evidenceIds: [] }], scores: [], total, kept });
const inputs = PLAN_EXAMPLE_INPUTS["chicago-18th-street"];

describe("the A/B test plan", () => {
  it("tests the kept concept against the runner-up, one store on two Saturdays, with the rule written first", () => {
    const test = buildAbTest(inputs, [concept("a", 20, true), concept("b", 18), concept("c", 19)])!;
    expect(abTestSchema.safeParse(test).success).toBe(true);
    expect(test.variants.map((v) => [v.id, v.conceptId])).toEqual([["a", "a"], ["b", "c"]]);
    expect(test.assignments).toEqual([
      { storeId: inputs.store.id, date: "2026-11-07", variant: "a" },
      { storeId: inputs.store.id, date: "2026-11-14", variant: "b" },
    ]);
    expect(test.metric).toBe("walk_ins");
    expect(test.decisionRule).toMatch(/20% or more/);
    expect(test.caveat).toBe(TEST_CAVEAT);
  });
  it("runs two stores on the same day, and falls back to the generic plan or the usual table", () => {
    const two = buildAbTest(inputs, [concept("a", 20, true)], { otherStoreId: "second-store" })!;
    expect(two.assignments.map((a) => [a.storeId, a.date])).toEqual([[inputs.store.id, inputs.date], ["second-store", inputs.date]]);
    expect(two.variants[1]).toMatchObject({ source: "generic" });
    expect(buildAbTest(inputs, [concept("a", 20, true)], { b: "usual" })?.variants[1]).toMatchObject({ source: "usual" });
    expect(buildAbTest(inputs, [concept("a", 20)])).toBeNull();
  });
});

describe("the wheel", () => {
  const PLACE = "00000000-0000-4000-8000-000000000002";
  const local = { city: null, gaps: [], block: { radiusM: 1500, places: [{ id: PLACE, name: "Quillon Smokehouse", kind: "food" as const, tags: [], address: null, distanceM: 26, why: null, rank: 1, affinity: null, popularity: null, evidenceIds: ["ev_00000000000b"] }] } };
  const aliases = buildAliases(local);
  it("goes outside only", () => {
    expect(wheelWanted(inputs)).toBe(true);
    expect(wheelWanted({ ...inputs, setting: "in_store" })).toBe(false);
  });
  it("quotes every promo verbatim, adds gift cards from the block with receipts, and counts them in the budget", () => {
    const { wheel, purchases, issues } = checkWheel({ promoLabels: [{ offer: 1, label: "$25 unlimited" }, { offer: 2, label: "Free phone forever" }], giftCards: [{ place: "p1", amountUsd: 10, cards: 2 }], snack: null }, inputs, aliases, guardFor(inputs, [PLACE]));
    expect(wheel?.slices.filter((s) => s.kind === "promo").map((s) => s.text)).toEqual(inputs.offers.map((o) => o.text));
    expect(wheel?.slices[0]?.label).toBe("$25 unlimited");
    expect(issues.join(" ")).toMatch(/promoLabels.2: a promo label uses only the promo's own words/);
    expect(wheel?.slices.find((s) => s.kind === "gift_card")).toMatchObject({ label: "$10 Quillon Smokehouse", origin: "qloo", refs: [PLACE], evidenceIds: ["ev_00000000000b"] });
    expect(purchases).toEqual([expect.objectContaining({ qty: "2 at $10 each", estUsd: 20, from: PLACE })]);
    expect(wheel?.rules[0]).toBe("Free to spin, no purchase needed. One spin per person.");
    expect(labelFromPromo("Free tablet", "Free tablet with a new line")).toBe(true);
    expect(labelFromPromo("Free tablet today", "Free tablet with a new line")).toBe(false);
  });
  it("trims one gift card before cutting a line when a plan runs over budget", () => {
    const draft = { runOfShow: [], checklist: [], estimatedCostUsd: 55, shopping: [{ item: "Cups", estUsd: 15, origin: "creative" as const, evidenceIds: [] }, { item: "Gift cards for the wheel", qty: "4 at $10 each", estUsd: 40, from: PLACE, origin: "interpreted" as const, evidenceIds: [] }] };
    const fitted = fitBudget(draft, 50);
    expect(fitted?.plan.estimatedCostUsd).toBe(45);
    expect(fitted?.plan.shopping.map((s) => s.item)).toEqual(["Cups", "Gift cards for the wheel"]);
    expect(fitBudget({ ...draft, shopping: [{ ...draft.shopping[1]!, qty: "1 at $10 each", estUsd: 10 }, { item: "Tent", estUsd: 90, origin: "creative" as const, evidenceIds: [] }] }, 50)?.plan.shopping.map((s) => s.item)).toEqual(["Gift cards for the wheel"]);
  });
});

describe("a month of Saturdays", () => {
  it("starts on the plan's Saturday", () => {
    expect(saturdaysFrom("2026-11-07")).toEqual(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"]);
    expect(saturdaysFrom("2026-11-05")[0]).toBe("2026-11-07");
  });
});

describeRecorded("a month for a recorded store", () => {
  it("rotates the concepts, the city's artists, the block's places and the promos, with no repeats week to week", async () => {
    const report = await loadExampleReport("chicago-18th-street");
    const weeks = planMonth(report);
    expect(weeks).toHaveLength(4);
    expect(weeks[0]?.conceptId).toBe(report.plan?.conceptId);
    expect(weeks[3]?.notes.join(" ")).toMatch(/Small Business Saturday/);
    const artists = new Set(report.local.city?.artists.map((a) => a.id));
    for (const week of weeks) for (const id of week.artistIds) expect(artists.has(id)).toBe(true);
    expect(weeks[0]?.artistIds).not.toEqual(weeks[1]?.artistIds);
    expect(weeks.map((w) => w.offer)).toEqual([0, 1, 2, 0].map((i) => report.inputs.offers[i]?.text ?? null));
  });
});
