import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { marginText, realityView } from "./reality";
import { ledgerOf } from "./receipts";
import { describeRecorded } from "../../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describeRecorded.each(EXAMPLES.map((e) => e.slug))("the Reality Check view for %s", (slug) => {
  const report = read(slug);
  const gap = report.audience.gap!;
  const view = realityView(report, ledgerOf(report))!;

  it("renders the gap stage's lines verbatim and in order", () => {
    expect(view.outcome).toBe(gap.outcome);
    expect(view.lines.map((l) => [l.kind, l.text])).toEqual(gap.lines.map((l) => [l.kind, l.text]));
    expect(view.dimensions.map(({ dimension, outcome }) => ({ dimension, outcome }))).toEqual(gap.dimensions.map(({ dimension, outcome }) => ({ dimension, outcome })));
  });

  it("says who each line speaks for, with a receipt only for what Qloo measured", () => {
    for (const line of view.lines) {
      const cited = gap.lines.find((l) => l.text === line.text)!.evidenceIds;
      if (line.kind === "stated") expect(line).toMatchObject({ source: "you", receipt: null });
      if (line.kind === "generic") expect(line).toMatchObject({ source: "generic", receipt: null });
      if (line.source === "qloo") expect(line.receipt).toMatchObject({ cue: "Reality Check", title: line.text, calls: new Set(cited).size });
      if (line.kind === "measured") expect(line.source).toBe("qloo");
    }
  });

  it("gives each dimension its own outcome, what was stated and measured, and its receipt", () => {
    view.dimensions.forEach((d, i) => {
      const source = gap.dimensions[i];
      expect(d).toMatchObject({ stated: source.stated, statedBy: source.statedBy, measured: source.measured, broad: source.broad });
      expect(d.label).toBe({ age: "Age", gender: "Gender", cities: "Cities", taste: "Taste" }[source.dimension]);
      expect(d.receipt).toMatchObject({ calls: new Set(source.evidenceIds).size });
      if (source.outcome === "not_stated") expect(d).toMatchObject({ outcomeLabel: "not stated", margin: null });
    });
  });
});

describeRecorded("the Reality Check view", () => {
  it("states a gap with its margin (food-hot-sauce)", () => {
    const report = read("food-hot-sauce");
    const age = realityView(report, ledgerOf(report))!.dimensions.find((d) => d.dimension === "age")!;
    expect(age).toMatchObject({ outcome: "gap", outcomeLabel: "gap", stated: "25 to 40", statedBy: "you", margin: "0.15 apart on the skew index" });
  });

  it("keeps a near tie a near tie (pets-outfits)", () => {
    const report = read("pets-outfits");
    const view = realityView(report, ledgerOf(report))!;
    expect(view.outcome).toBe("partly");
    expect(view.lines.find((l) => l.kind === "near")?.text).toMatch(/^Near tie on age: .*so it isn't a gap\.$/);
    const age = view.dimensions.find((d) => d.dimension === "age")!;
    expect(age).toMatchObject({ outcome: "near_tie", outcomeLabel: "near tie", margin: "0.03 apart on the skew index" });
    expect(view.dimensions.map((d) => d.outcomeLabel)).not.toContain("gap");
  });

  it("words every margin by its dimension and never shows one for an unstated dimension", () => {
    const d = { position: null, measured: "x" };
    expect(marginText({ ...d, dimension: "age", margin: 0.295, outcome: "gap" })).toBe("0.29 apart on the skew index");
    expect(marginText({ ...d, dimension: "gender", margin: 0.63, outcome: "confirmed", measured: "skews female (0.63)" })).toBe("strongest skew 0.63");
    // Never negative, and none for a balanced reading.
    expect(marginText({ ...d, dimension: "gender", margin: -0.15, outcome: "gap", measured: "skews male (0.15)" })).toBe("strongest skew 0.15");
    expect(marginText({ ...d, dimension: "gender", margin: 0.02, outcome: "gap", measured: "balanced" })).toBeNull();
    expect(marginText({ ...d, dimension: "cities", margin: 7, outcome: "near_tie" })).toBe("#7 by lift");
    expect(marginText({ ...d, dimension: "taste", margin: null, position: { tag: "Soul - Funk", beats: 0, of: 19 }, outcome: "gap" })).toBe("Soul - Funk beats 0 of 19 reference tags");
    expect(marginText({ ...d, dimension: "age", margin: 0.2, outcome: "not_stated" })).toBeNull();
    expect(marginText({ ...d, dimension: "taste", margin: null, outcome: "unverifiable" })).toBeNull();
  });

  it("drops the Qloo tag from a line whose evidence is not in the ledger", () => {
    const report = read("food-hot-sauce");
    const gap = structuredClone(report.audience.gap!);
    gap.lines = gap.lines.map((l) => (l.kind === "measured" ? { ...l, evidenceIds: ["ev_000000000000"] } : l));
    const view = realityView({ ...report, audience: { ...report.audience, gap } }, ledgerOf(report))!;
    expect(view.lines.find((l) => l.kind === "measured")).toMatchObject({ source: null, receipt: null });
  });

  it("is null before the gap stage", () => {
    const report = read("food-hot-sauce");
    expect(realityView({ ...report, audience: { ...report.audience, gap: null } }, ledgerOf(report))).toBeNull();
  });
});
