import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { plainType } from "./format";
import { ledgerOf } from "./receipts";
import { whyView } from "./why";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("the Why it works view for %s", (slug) => {
  const report = read(slug);
  const proof = report.audience.proof!;
  const view = whyView(report, ledgerOf(report));

  it("shows every seed with its origin and its receipt", () => {
    expect(view.seeds.map(({ name, kind, origin, match }) => ({ name, kind, origin, match }))).toEqual(
      proof.seeds.map((s) => ({ name: s.ref.name, kind: plainType(s.ref.type), origin: s.origin, match: s.match ?? null })),
    );
    for (const seed of view.seeds) expect(seed.receipt?.calls).toBeGreaterThan(0);
  });

  it("lists the top stable cities by lift, each with its receipt, and the headline", () => {
    const stable = proof.cities.filter((c) => c.flags.length === 0).slice(0, 3);
    expect(view.cities.map(({ label, rank, comparedWith }) => ({ label, rank, comparedWith }))).toEqual(
      stable.map(({ label, rank, comparedWith }) => ({ label, rank, comparedWith })),
    );
    for (const city of view.cities) expect(city.receipt).toMatchObject({ cue: "City", calls: 1 });
    expect(view.comparisonHeadline).toBe(report.comparison!.headline);
    expect(view.flags).toEqual(proof.flags);
  });
});

describe("the Why it works view", () => {
  it("leaves out a city flagged as swinging, as the Reality Check does (home-candles)", () => {
    const report = read("home-candles");
    const view = whyView(report, ledgerOf(report));
    const flagged = report.audience.proof!.cities.find((c) => c.flags.length > 0)!;
    expect(view.cities.map((c) => c.label)).not.toContain(flagged.label);
    // The Reality Check names the first stable city: the same one leads here.
    const measured = report.audience.gap!.lines.find((l) => l.kind === "measured")!.text;
    expect(measured).toContain(`around ${view.cities[0].label}`);
  });

  it("says in the receipt when a seed matched under a longer name (food-hot-sauce)", () => {
    const report = read("food-hot-sauce");
    const affix = whyView(report, ledgerOf(report)).seeds.find((s) => s.match === "affix")!;
    expect(affix.receipt?.rows[0]).toEqual({ label: "Matched", value: "Qloo lists it under a longer name" });
  });
});
