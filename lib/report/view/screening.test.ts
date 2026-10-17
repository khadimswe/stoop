import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { skewText } from "./format";
import { ledgerOf } from "./receipts";
import { screeningView } from "./screening";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("the Screening Room view for %s", (slug) => {
  const report = read(slug);
  const view = screeningView(report, ledgerOf(report), null);
  const segments = report.audience.segments!.items;

  it("pins the Control once, then one row per world in segment order", () => {
    expect(view.control).toEqual({ clip: null });
    expect(view.worlds.map((w) => [w.segmentId, w.label])).toEqual(report.worlds.map((w) => [w.segmentId, w.label]));
  });

  it("shows each world's adult age band, its skew and its setting city, each with a receipt", () => {
    view.worlds.forEach((row, i) => {
      const world = report.worlds[i];
      const segment = segments.find((s) => s.id === world.segmentId)!;
      expect(row).toMatchObject({ ageBand: segment.ageBand, skewText: skewText(segment.skew), settingCity: world.settingCity!.label, clip: null });
      expect(row.ageBand).not.toMatch(/24 and younger|24_and_younger/);
      expect(row.skewReceipt).toMatchObject({ cue: "Age skew", calls: new Set(segment.evidenceIds).size });
      expect(row.settingReceipt).toMatchObject({ cue: "Setting city", calls: new Set(world.settingCity!.evidenceIds).size });
    });
  });
});
