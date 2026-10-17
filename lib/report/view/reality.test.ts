import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { realityView } from "./reality";
import { ledgerOf } from "./receipts";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("the Reality Check view for %s", (slug) => {
  const report = read(slug);
  const gap = report.audience.gap!;
  const view = realityView(report, ledgerOf(report))!;

  it("renders the gap stage's lines verbatim and in order", () => {
    expect(view.outcome).toBe(gap.outcome);
    expect(view.lines.map((l) => [l.kind, l.text])).toEqual(gap.lines.map((l) => [l.kind, l.text]));
    expect(view.dimensions).toEqual(gap.dimensions.map(({ dimension, outcome }) => ({ dimension, outcome })));
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
});

describe("the Reality Check view", () => {
  it("keeps a near tie a near tie (pets-outfits)", () => {
    const view = realityView(read("pets-outfits"), ledgerOf(read("pets-outfits")))!;
    expect(view.outcome).toBe("partly");
    expect(view.lines.find((l) => l.kind === "near")?.text).toMatch(/^Near tie on age: .*so it isn't a gap\.$/);
    expect(view.dimensions.find((d) => d.dimension === "age")?.outcome).toBe("near_tie");
  });

  it("is null before the gap stage", () => {
    const report = read("food-hot-sauce");
    expect(realityView({ ...report, audience: { ...report.audience, gap: null } }, ledgerOf(report))).toBeNull();
  });
});
