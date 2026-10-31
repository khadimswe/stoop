import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planEventSchema, reducePlan, toPlanReport } from "../events";
import { PLAN_EXAMPLES, examplePlanId } from "../example-list";
import { describeRecorded, ifRecorded } from "../../testing/recorded";
import { MIN_FOOD_PLACES, countCuisines, cuisineLabel, cuisineLine, type CuisinePlace } from "./cuisines";
import { planView, sourceFromReport } from "./plan";

// Made-up places: the tag names are ordinary cuisine and filler words, not a recording.
const food = (rank: number, ...tags: string[]): CuisinePlace => ({ kind: "food", tags, rank });

describe("cuisineLabel", () => {
  it("counts cuisine and food-type tags, matched case-insensitively", () => {
    expect(cuisineLabel("Mexican")).toBe("Mexican");
    expect(cuisineLabel("  coffee   SHOP ")).toBe("coffee");
    expect(cuisineLabel("Cafe")).toBe("coffee");
    expect(cuisineLabel("Taqueria")).toBe("Mexican");
    expect(cuisineLabel("Ice cream shop")).toBe("ice cream");
  });

  it("leaves out price, ambience, service and generic tags", () => {
    for (const tag of ["Restaurant", "Food", "Inexpensive", "Cheap", "Casual", "Takeout", "Takeout restaurant", "Fast food", "Lively", "Welcoming", "Family friendly", "Urban", "Tourist attraction", "Event venue", "Park", "Live music venue"]) {
      expect(cuisineLabel(tag), tag).toBeNull();
    }
  });
});

describe("countCuisines", () => {
  it("counts each food place once per label and skips places that are not food", () => {
    const { counts, foodPlaces } = countCuisines([
      food(1, "Coffee shop", "Cafe", "Restaurant"),
      food(2, "Mexican", "Taqueria", "Casual"),
      food(3, "Mexican", "Lively"),
      { kind: "venue", tags: ["Mexican", "Coffee shop"], rank: 1 },
      food(4, "Restaurant", "Inexpensive"),
    ]);
    expect(foodPlaces).toBe(3);
    expect(counts.map((c) => [c.label, c.places])).toEqual([
      ["Mexican", 2],
      ["coffee", 1],
    ]);
  });

  it("breaks ties by Qloo's rank of the first place carrying the tag, then by the plan's order", () => {
    const { counts } = countCuisines([food(7, "Italian"), food(3, "Seafood"), food(5, "Pizza"), food(9, "Italian"), food(4, "Seafood"), food(5, "Bakery"), food(6, "Pizza")]);
    expect(counts.map((c) => c.label)).toEqual(["seafood", "pizza", "Italian", "bakery"]);
  });
});

describe("cuisineLine", () => {
  it("names the top three, near the store or near the event", () => {
    const places = [food(1, "Mexican"), food(2, "Mexican", "Coffee shop"), food(3, "Caribbean"), food(4, "Coffee shop"), food(5, "Pizza"), food(6, "Caribbean")];
    expect(cuisineLine(places, "the store")).toBe("The food spots near your store, by Qloo's tags: most often Mexican, coffee and Caribbean.");
    expect(cuisineLine(places, "the event")).toBe("The food spots near the event, by Qloo's tags: most often Mexican, coffee and Caribbean.");
  });

  it("lists two cleanly when only two labels exist", () => {
    expect(cuisineLine([food(1, "Thai"), food(2, "Bakery")], "the store")).toBe("The food spots near your store, by Qloo's tags: most often Thai and bakery.");
  });

  it(`hides when fewer than ${MIN_FOOD_PLACES} food places carry an allowed tag`, () => {
    expect(cuisineLine([], "the store")).toBeNull();
    expect(cuisineLine([food(1, "Mexican", "Coffee shop", "Pizza")], "the store")).toBeNull();
    expect(cuisineLine([food(1, "Mexican"), food(2, "Restaurant", "Casual"), { kind: "park", tags: ["Mexican"], rank: 1 }], "the store")).toBeNull();
  });

  it("describes places, never people", () => {
    const line = cuisineLine([food(1, "Mexican"), food(2, "Jamaican"), food(3, "Soul food")], "the store") ?? "";
    expect(line).toMatch(/^The food spots near/);
    expect(line).not.toMatch(/customers|community is|people|block|snacks/i);
  });
});

// The recorded examples (data/plans/<slug>/plan.events.json), through the same view model the pages use.
const views = ifRecorded(() =>
  PLAN_EXAMPLES.map(({ slug }) => {
    const events = planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
    const report = toPlanReport(reducePlan(events), "recorded");
    return { slug, report, view: planView(sourceFromReport(report, examplePlanId(slug))) };
  }),
);

describeRecorded("the cuisine line on each example", () => {
  for (const { slug, report, view } of views) {
    it(`${slug}: shows a summary of its own food tags, or is hidden by rule`, () => {
      const places = report.local.block?.places ?? [];
      const line = view.local.block?.cuisineLine ?? null;
      const { counts, foodPlaces } = countCuisines(places);
      if (foodPlaces < MIN_FOOD_PLACES) {
        expect(line).toBeNull();
        return;
      }
      const from = view.local.block?.from === "the event" ? "the event" : "your store";
      expect(line).toMatch(new RegExp(`^The food spots near ${from}, by Qloo's tags: most often .+\\.$`));
      // Every label it names comes from a tag on at least one of the example's own food places.
      const top = counts.slice(0, 3);
      expect(top.length).toBeGreaterThan(0);
      for (const c of top) {
        expect(line).toContain(c.label);
        expect(places.some((p) => p.kind === "food" && p.tags.some((t) => cuisineLabel(t) === c.label))).toBe(true);
      }
    });
  }
});
