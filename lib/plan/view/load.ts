// The example stores' recorded runs, for pages. Each is read from data/plans/<slug>/plan.events.json
// with a synchronous file read and reduced with the shared reducer, the same way the plan store builds
// a report (the report is never stored on its own, so it cannot drift from its events). Next
// prerenders a page whose only I/O is synchronous, so the example pages stay fully static and read
// nothing at request time. An example that is not recorded yet is simply left out.
//
// Server only: a run is a few hundred KB. Pages build narrow view models (./plan.ts) from it.
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { planEventSchema, reducePlan, toPlanReport } from "../events";
import { examplePlanId, PLAN_EXAMPLES, type PlanExampleSlug } from "../example-list";
import type { PlanReport } from "../schema";
import { planView, sourceFromReport, type PlanView } from "./plan";

const file = (slug: PlanExampleSlug) => path.join(process.cwd(), "data", "plans", slug, "plan.events.json");

const reports = new Map<PlanExampleSlug, PlanReport>();

/** The example slugs whose recorded run is on disk, in PLAN_EXAMPLES order. */
export function recordedPlanSlugs(): PlanExampleSlug[] {
  return PLAN_EXAMPLES.map((e) => e.slug).filter((slug) => existsSync(file(slug)));
}

export function isRecordedPlanSlug(value: string): value is PlanExampleSlug {
  return (recordedPlanSlugs() as string[]).includes(value);
}

/** One example's report, reduced from its recorded events and validated the first time it is asked for. */
export function loadPlanExampleReport(slug: PlanExampleSlug): PlanReport {
  let report = reports.get(slug);
  if (!report) {
    const events = planEventSchema.array().parse(JSON.parse(readFileSync(file(slug), "utf8")));
    report = toPlanReport(reducePlan(events), "recorded");
    reports.set(slug, report);
  }
  return report;
}

/** One example's plan page view, under its plan id ("ex-<slug>"). */
export function loadPlanExampleView(slug: PlanExampleSlug): PlanView {
  return planView(sourceFromReport(loadPlanExampleReport(slug), examplePlanId(slug)));
}
