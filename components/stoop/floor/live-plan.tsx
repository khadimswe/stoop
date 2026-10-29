"use client";

import { Check, ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { railRows } from "@/lib/plan/view/live";
import { planView, sourceFromReport, sourceFromState, type PlanView } from "@/lib/plan/view/plan";
import type { PlanInputs } from "@/lib/plan/schema";
import { usePlanEvents } from "../plan/use-plan-events";
import { EventScreen } from "./event-screen";
import { ActionBar, AppBar, IconSlot, Notice, PRIMARY, ScreenBody, ScreenTitle, Stepper, type Step } from "./kit";
import { PosterScreen } from "./poster-screen";
import { PromoteScreen } from "./promote-screen";

export type LiveStepName = "event" | "poster" | "promote";

const STEP_OF: Record<LiveStepName, Step> = { event: "Event", poster: "Poster", promote: "Promote" };

/** Where a live plan's steps link: its own pages, and back to /start for the block and the form. */
export function liveHrefs(id: string) {
  const base = `/plan/${encodeURIComponent(id)}`;
  return {
    event: base,
    poster: `${base}/poster`,
    promote: `${base}/promote`,
    steps: { Community: "/start", Create: "/start", Event: base, Poster: `${base}/poster` } as Partial<Record<Step, string>>,
  };
}

/** A state that is not a plan: what happened and what to do, with one way on. */
function StateScreen({ step, title, children, action }: { step: Step; title: string; children: React.ReactNode; action: { href: string; label: string } }) {
  return (
    <>
      <AppBar
        left={
          <IconSlot href="/start" label="Back">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title={title}
      />
      <Stepper current={step} />
      <ScreenBody>
        <ScreenTitle title={title} />
        {children}
      </ScreenBody>
      <ActionBar>
        <Link href={action.href} className={PRIMARY}>
          {action.label}
        </Link>
      </ActionBar>
    </>
  );
}

/**
 * A live plan's steps, filled from its events (GET /api/plan/[id]/events). While the agent works the
 * Event step is "Planning your event": the stages as a calm list, each Qloo call and decision under
 * its stage as it lands. Not found, failed and offline each say what happened and what to do.
 */
export function LiveStep({ planId, step }: { planId: string; step: LiveStepName }) {
  const feed = usePlanEvents(planId);
  const hrefs = liveHrefs(planId);
  const built = useMemo((): { view: PlanView; inputs: PlanInputs } | null => {
    if (feed.phase === "report") return { view: planView(sourceFromReport(feed.report, planId)), inputs: feed.report.inputs };
    if (feed.phase === "streaming" || feed.phase === "ended") {
      const source = sourceFromState(feed.state, planId);
      return source ? { view: planView(source), inputs: source.inputs } : null;
    }
    return null;
  }, [feed, planId]);

  if (feed.phase === "not-found")
    return (
      <StateScreen step={STEP_OF[step]} title="This plan isn't here" action={{ href: "/start", label: "Plan an event" }}>
        <Notice title="Live plans are kept for a few days">This one has expired, or the link is wrong. Start a new plan; it takes about a minute.</Notice>
      </StateScreen>
    );
  if (feed.phase === "error")
    return (
      <StateScreen step={STEP_OF[step]} title="Your event" action={{ href: hrefs.event, label: "Try again" }}>
        <Notice tone="bad" title="The plan didn't load">
          {feed.message}
        </Notice>
      </StateScreen>
    );
  if ((feed.phase === "streaming" || feed.phase === "ended") && feed.state.status === "failed" && !feed.state.report.plan)
    return (
      <StateScreen step="Event" title="The plan stopped" action={{ href: "/start", label: "Plan it again" }}>
        <Notice tone="bad" title="Stoop couldn't finish this plan">
          {feed.state.failure ?? "Something went wrong while planning."} Nothing was posted anywhere.
        </Notice>
      </StateScreen>
    );

  const running = feed.phase === "connecting" || (feed.phase === "streaming" && feed.state.status === "running");
  if (!built || (step === "event" && !built.view.concept)) {
    const rail = feed.phase === "streaming" || feed.phase === "ended" ? railRows(feed.state) : [];
    const trace = feed.phase === "streaming" || feed.phase === "ended" ? feed.state.report.trace : [];
    return (
      <>
        <AppBar title="Planning your event" />
        <Stepper current="Event" />
        <ScreenBody>
          <ScreenTitle title="Planning your event" meta="About a minute. Keep this page open." />
          <ol aria-label="Progress" aria-live="polite" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            {(rail.length ? rail : [{ stage: "store", label: "Starting", status: "current" as const, calls: { live: 0, cached: 0 } }]).map((r) => {
              const steps = trace.filter((t) => t.stage === r.stage);
              return (
                <li key={r.stage} className="flex flex-col gap-1 px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">
                      {r.status === "done" ? (
                        <span className="flex size-5 items-center justify-center rounded-full bg-fl-ink">
                          <Check className="size-3 text-white" strokeWidth={3} />
                        </span>
                      ) : r.status === "current" ? (
                        <Loader2 className="size-5 motion-safe:animate-spin" />
                      ) : (
                        <span className="size-4 rounded-full border-[1.5px] border-fl-line" />
                      )}
                    </span>
                    <span className={r.status === "pending" ? "flex-1 text-[0.9375rem] text-fl-dim" : "flex-1 text-[0.9375rem] font-medium"}>
                      <span className="sr-only">{r.status === "done" ? "Done: " : r.status === "current" ? "In progress: " : "Waiting: "}</span>
                      {r.label}
                    </span>
                    {r.calls.live + r.calls.cached > 0 && <span className="text-xs text-fl-dim tabular-nums">{r.calls.live + r.calls.cached} Qloo</span>}
                  </span>
                  {r.status === "current" && steps.at(-1) && <span className="pl-9 text-[0.8125rem] text-fl-dim">{steps.at(-1)!.label}</span>}
                </li>
              );
            })}
          </ol>
          <p className="text-[0.8125rem] text-fl-dim">Nothing posts anywhere. You get drafts to check.</p>
        </ScreenBody>
      </>
    );
  }

  if (step === "poster") return <PosterScreen view={built.view} live hrefs={{ back: hrefs.event, promote: hrefs.promote, steps: hrefs.steps }} />;
  if (step === "promote") return <PromoteScreen view={built.view} inputs={built.inputs} hrefs={{ back: hrefs.poster, steps: hrefs.steps }} />;
  return (
    <EventScreen
      view={built.view}
      running={running}
      hrefs={{ back: "/start", poster: hrefs.poster, steps: hrefs.steps }}
      top={running ? <Notice title="Still planning">The rest fills in as Qloo answers.</Notice> : null}
    />
  );
}
