import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planEventSchema, reducePlan, toPlanReport } from "../events";
import { PLAN_EXAMPLES, examplePlanId } from "../example-list";
import { eventPageView } from "./event-page";
import { sourceFromReport } from "./plan";

// The public event page, against the recorded example runs.
for (const { slug } of PLAN_EXAMPLES) {
  const events = planEventSchema.array().parse(JSON.parse(readFileSync(path.join("data", "plans", slug, "plan.events.json"), "utf8")));
  const view = eventPageView(sourceFromReport(toPlanReport(reducePlan(events), "recorded"), examplePlanId(slug)));

  describe(`the public event page: ${slug}`, () => {
    it("says what is at the table: the music, the snacks and their place, the wheel", () => {
      expect(view.draws.music).toMatch(/^Music .+ plays$/);
      expect(view.draws.snacks).toMatch(/^Snacks and drinks from /);
      expect(view.draws.wheel?.prizes.length).toBeGreaterThan(0);
      expect(view.draws.wheel?.rule).toMatch(/free to spin/i);
    });

    it("never names artists, never shows a ref token", () => {
      const text = JSON.stringify(view.draws);
      expect(text).not.toContain("[[");
      const report = toPlanReport(reducePlan(events), "recorded");
      for (const a of report.local.city?.artists ?? []) expect(text).not.toContain(a.name);
    });
  });
}
