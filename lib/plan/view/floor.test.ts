import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planEventSchema, reducePlan, toPlanReport } from "../events";
import { PLAN_EXAMPLES, examplePlanId, type PlanExampleSlug } from "../example-list";
import { titleGenre } from "../words";
import { about, budgetView, eventStats, judgeView, kindCounts, landingCompare, placeMeta, playView, prizesLine, prizesView, snackGroups, snacksView, venueLine } from "./floor";
import { noGenre, planView, posterRoute, safeReason, sourceFromReport, stepLabel, type PlanView } from "./plan";

// The floor's selectors, against the recorded example runs (data/plans/<slug>/plan.events.json).
function viewOf(slug: PlanExampleSlug): PlanView {
  const events = planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
  return planView(sourceFromReport(toPlanReport(reducePlan(events), "recorded"), examplePlanId(slug)));
}
const views = PLAN_EXAMPLES.map(({ slug }) => ({ slug, view: viewOf(slug) }));

describe("the floor's selectors on each example", () => {
  for (const { slug, view } of views) {
    it(`${slug}: the block's kind chips add up and leave out empty kinds`, () => {
      const places = view.local.block?.places ?? [];
      const chips = kindCounts(places);
      expect(chips[0]).toEqual({ kind: "all", label: "All", count: places.length });
      expect(chips.slice(1).reduce((sum, c) => sum + c.count, 0)).toBe(places.length);
      expect(chips.slice(1).every((c) => c.count > 0)).toBe(true);
    });

    it(`${slug}: Play names artists only, and Snacks never lists a prize`, () => {
      const play = playView(view);
      expect(play.artists.length).toBeGreaterThan(0);
      expect(play.receipt).not.toBeNull();
      expect(play.note ?? "").not.toMatch(/genre|rap|hip.hop|latin|r&b/i);
      const snacks = snacksView(view);
      expect(snacks.items.every((s) => !s.prize)).toBe(true);
      const prizes = prizesLine(view);
      if (view.shopping.some((s) => s.prize)) expect(prizes).toMatch(/^Prizes on the list: .+ · \$\d+/);
      else expect(prizes).toBeNull();
    });

    it(`${slug}: the event's numbers are the spend, the block spots and the wheel`, () => {
      const stats = eventStats(view);
      expect(stats).toHaveLength(3);
      expect(stats[0]!.value).toMatch(/^\$\d+/);
      expect(stats[0]!.label).toMatch(/^of \$\d+/);
      expect(Number(stats[1]!.value)).toBe(view.partnerIds.length);
    });

    it(`${slug}: the judges' fold and the landing table never print a genre-led line`, () => {
      const judge = judgeView(view);
      expect(judge).not.toBeNull();
      expect(judge!.stats[0]!.label).toBe("lines cite Qloo");
      for (const line of [...judge!.pairs.flatMap((p) => [p.generic, p.stoop ?? ""]), ...judge!.lines]) expect(titleGenre(line)).toBeNull();
      const rows = landingCompare(view);
      for (const r of rows) for (const text of [r.generic, r.stoop]) expect(titleGenre(text)).toBeNull();
    });

    it(`${slug}: never flags the manager's own promo sign as a cliche`, () => {
      const judge = judgeView(view)!;
      for (const pair of judge.pairs) expect(pair.generic).not.toMatch(/\$\d+\/mo|port in|taxes and fees/i);
    });
  }
});

describe("the event page's groups", () => {
  for (const { slug, view } of views) {
    it(`${slug}: snacks sit under their place once, prizes and snacks add up to the spend`, () => {
      const groups = snackGroups(view);
      const pins = groups.flatMap((g) => (g.place ? [g.place.n] : []));
      expect(new Set(pins).size).toBe(pins.length);
      expect(groups.flatMap((g) => g.items)).toHaveLength(snacksView(view).items.length);
      const budget = budgetView(view);
      expect(budget.spentText).toBe(eventStats(view)[0]!.value);
      const prizes = prizesView(view);
      if (prizes) expect(prizes.items).toHaveLength(view.shopping.filter((s) => s.prize).length);
    });
  }

  it("keeps an article lowercase after At, and says prices are estimates", () => {
    expect(venueLine("A fall community fair on Navigation Blvd")).toBe("At a fall community fair on Navigation Blvd");
    expect(venueLine("Pilsen Fall Fest")).toBe("At Pilsen Fall Fest");
    expect(about("$11")).toBe("about $11");
    expect(about(null)).toBeNull();
  });
});
describe("small wording rules", () => {
  it("places read kind, distance, next door and chain in one line", () => {
    expect(placeMeta({ kindLabel: "Food", distanceText: "100 ft", distanceM: 26, chain: false })).toBe("Food · next door");
    expect(placeMeta({ kindLabel: "Shop", distanceText: "0.5 mi", distanceM: 800, chain: true })).toBe("Shop · 0.5 mi · chain");
  });

  it("counts left-out tags instead of naming them, and drops quoted or genre reasons", () => {
    expect(safeReason("Left out 4 identity tags", "queer, christian")).toBe("Each describes who people are, not what they play. Stoop reads taste, never identity.");
    expect(safeReason("Left out 3 music tags", "gangsta rap, drill")).toBe("Not a style to play, or not the city's own.");
    expect(safeReason("Read the city", 'Qloo returned "Mexican Pop"')).toBeNull();
    expect(safeReason("Read the city", "Qloo ranked 20 artists for adults 25 to 34.")).toBe("Qloo ranked 20 artists for adults 25 to 34.");
    expect(safeReason("Read the city", undefined)).toBeNull();
  });

  it("says a genre-led line is what it is", () => {
    expect(noGenre("Hip-Hop playlist with top hits")).toBe("Names a music genre, no local signal");
    expect(noGenre("Coffee from the cafe next door")).toBe("Coffee from the cafe next door");
  });

  it("labels a timeline step by its short first clause and capitalizes the rest", () => {
    expect(stepLabel([{ kind: "text", text: "Open. put the wheel by the door" }])).toEqual({ label: "Open", rest: [{ kind: "text", text: "Put the wheel by the door" }] });
    const long = [{ kind: "text" as const, text: "Set the table up by the front door before noon" }];
    expect(stepLabel(long)).toEqual({ label: null, rest: long });
  });

  it("asks the poster route for the right size", () => {
    expect(posterRoute("ex-a")).toBe("/api/plan/ex-a/marketing/poster.png");
    expect(posterRoute("ex-a", "thumb")).toBe("/api/plan/ex-a/marketing/poster.png?size=thumb");
    expect(posterRoute("ex-a", "medium")).toBe("/api/plan/ex-a/marketing/poster.png?size=medium");
  });
});
