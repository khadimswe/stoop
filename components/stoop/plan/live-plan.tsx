"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { examplePlanPath, LEAD_PLAN_EXAMPLE } from "@/lib/plan/example-list";
import { railRows } from "@/lib/plan/view/live";
import { planView, sourceFromReport, sourceFromState } from "@/lib/plan/view/plan";
import { ProgressRail } from "../trace/progress-rail";
import { PlanPage } from "./plan-page";
import { PlanSkeleton, PlanStateCard } from "./plan-states";
import { usePlanEvents } from "./use-plan-events";

const EXAMPLE_HREF = examplePlanPath(LEAD_PLAN_EXAMPLE.slug);

/**
 * A live plan: its events stream in (GET /api/plan/[id]/events) and the page fills section by
 * section, with the stages on a progress rail above it until the run ends. The view is built in the
 * browser from the same reducer and builder the example pages use, so a finished live plan and an
 * example look the same. Never a blank screen: loading, not found and failed each say so.
 */
export function LivePlan({ planId }: { planId: string }) {
  const feed = usePlanEvents(planId);
  const view = useMemo(() => {
    if (feed.phase === "report") return planView(sourceFromReport(feed.report, planId));
    if (feed.phase === "streaming" || feed.phase === "ended") {
      const source = sourceFromState(feed.state, planId);
      return source ? planView(source) : null;
    }
    return null;
  }, [feed, planId]);

  if (feed.phase === "not-found") {
    return (
      <PlanStateCard title="This plan isn't here" exampleHref={EXAMPLE_HREF}>
        <p>Live plans are kept for a few days. This one has expired, or the link is wrong.</p>
      </PlanStateCard>
    );
  }
  if (feed.phase === "error") {
    return (
      <PlanStateCard title="Your event plan" exampleHref={EXAMPLE_HREF}>
        <p>{feed.message}</p>
      </PlanStateCard>
    );
  }
  if ((feed.phase === "streaming" || feed.phase === "ended") && feed.state.status === "failed" && !feed.state.report.plan) {
    return (
      <PlanStateCard title="This plan stopped" exampleHref={EXAMPLE_HREF}>
        <p>{feed.state.failure ?? "Stoop could not finish this plan."} Nothing was posted anywhere.</p>
      </PlanStateCard>
    );
  }
  if (!view) return <PlanSkeleton label={feed.phase === "connecting" ? "Connecting to your plan..." : "Starting your plan..."} />;

  const running = feed.phase === "streaming" && feed.state.status === "running";
  const rail = feed.phase === "streaming" || feed.phase === "ended" ? railRows(feed.state) : null;
  return (
    <PlanPage
      view={view}
      running={running}
      landmark={false}
      top={
        running && rail ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <p className="text-sm font-semibold">Planning your event. Sections fill in as Qloo answers.</p>
            <ProgressRail rows={rail} className="max-w-xl" />
          </div>
        ) : null
      }
      stickyNote={running ? "Still planning. Nothing posts on its own." : "Share it from the event page."}
      stickyAction={
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href={view.marketing.eventPath}>Open the event page</Link>
        </Button>
      }
    />
  );
}
