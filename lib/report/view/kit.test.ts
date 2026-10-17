import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import type { Report } from "../schema";
import { kitView } from "./kit";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

describe.each(EXAMPLES.map((e) => e.slug))("the Campaign Kit view for %s", (slug) => {
  const report = read(slug);
  const view = kitView(report);

  it("groups every script and the ad plan under its world", () => {
    expect(view.worlds.map((w) => [w.segmentId, w.label, w.scripts.length, w.adPlan?.name])).toEqual(
      report.worlds.map((w) => [w.segmentId, w.label, w.kit!.ugc.length, w.kit!.adPlan?.name]),
    );
    view.worlds.forEach((row, i) => {
      const { concept } = report.worlds[i].pack!;
      expect(row).toMatchObject({ hook: concept.hook, testHypothesis: concept.testHypothesis ?? null });
      expect(row.scripts.map((s) => s.script)).toEqual(report.worlds[i].kit!.ugc.map((s) => s.script));
      for (const script of row.scripts) expect(script.formatLabel).toMatch(/^[A-Z]/);
    });
  });
});
