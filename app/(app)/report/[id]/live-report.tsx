"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ReportPage } from "@/components/stoop/report/report-page";
import { LiveActionsProvider } from "@/components/stoop/report/revise/live-actions";
import { WaitlistTrigger } from "@/components/stoop/waitlist-trigger";
import { Button } from "@/components/ui/button";
import { useLiveReport } from "@/hooks/use-live-report";
import type { Report } from "@/lib/report/schema";
import { reportView } from "@/lib/report/view/report";
import { EXAMPLE_HREF, ExampleLink, ReportSkeleton, STAGE_WORDS, StateCard, StateShell } from "./states";

/** A run that failed before Qloo measured anything has nothing to show but what happened. */
const failedEarly = (report: Report) => report.partial !== null && report.audience.proof === null;

function PartialBanner({ report }: { report: Report }) {
  if (!report.partial) return null;
  return (
    <aside aria-label="This run stopped early" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-4 py-2.5">
      <p className="text-sm">
        <span className="font-semibold">This run stopped early</span>
        <span className="text-ink-soft">
          {" "}
          while {STAGE_WORDS[report.partial.stage]?.toLowerCase() ?? report.partial.stage}: {report.partial.reason} Below is what Qloo measured before it stopped.
        </span>
      </p>
      <ExampleLink />
    </aside>
  );
}

function EmailKit({ runId }: { runId: string }) {
  return (
    <div className="w-full sm:w-auto [&_button]:w-full sm:[&_button]:w-auto">
      <WaitlistTrigger label="Email me this kit" variant="default" size="default" source={runId} />
    </div>
  );
}

function LiveReportView({ report, runId, actions }: { report: Report; runId: string; actions: ReturnType<typeof useLiveReport>["actions"] }) {
  // The same view models as the examples; render access stays off until the render lane swaps it.
  const view = useMemo(() => reportView(report, { renderAccess: { kind: "off" } }), [report]);
  return (
    <LiveActionsProvider value={actions}>
      <ReportPage view={view} banner={report.partial ? <PartialBanner report={report} /> : undefined} stickyAction={<EmailKit runId={runId} />} />
    </LiveActionsProvider>
  );
}

/**
 * A live run's report, loaded in the browser (GET /api/report/<id> plus the run's event stream) and
 * rendered with the same view models and sections as the examples. Every state has words and a way
 * forward: a run still going links to its live trace, a stopped run offers Resume, a failed run says
 * what happened, and anything that cannot load points to the examples.
 */
export function LiveReport({ runId }: { runId: string }) {
  const { phase, resume, onResume, retry, actions } = useLiveReport(runId);

  switch (phase.kind) {
    case "loading":
      return <ReportSkeleton />;
    case "running":
      return (
        <StateShell>
          <StateCard title="Your run is still going">
            <p className="text-sm text-ink-soft">The report opens here when it finishes. You can watch each Qloo call and agent decision as it happens.</p>
            <p role="status" aria-live="polite" className="font-mono text-xs text-ink-soft">
              {phase.stage ? STAGE_WORDS[phase.stage] : "Starting"}
              {phase.steps > 0 && ` · ${phase.steps} ${phase.steps === 1 ? "step" : "steps"} so far`}
            </p>
            <Button asChild>
              <Link href={`/run/${runId}`}>Watch the agent work</Link>
            </Button>
          </StateCard>
        </StateShell>
      );
    case "stopped":
      return (
        <StateShell>
          <StateCard title="This run stopped before it finished">
            <p className="text-sm text-ink-soft">
              It ran out of time or lost its server. Resume picks it up from what it already measured, so Qloo is not asked the same questions twice.
            </p>
            <Button type="button" onClick={() => void onResume()} disabled={resume.state === "sending"}>
              {resume.state === "sending" ? "Resuming" : "Resume"}
            </Button>
            <p role="status" aria-live="polite" className={resume.message ? "text-sm" : "sr-only"}>
              {resume.message ?? ""}
            </p>
            {resume.exampleHref ? (
              <Link href={resume.exampleHref} className="text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
                See the example run
              </Link>
            ) : (
              <ExampleLink />
            )}
          </StateCard>
        </StateShell>
      );
    case "unavailable":
      return (
        <StateShell>
          <StateCard title={phase.reason === "not_found" ? "This report is not here" : "This report could not load"}>
            <p className="text-sm text-ink-soft">
              {phase.message} {phase.reason === "not_found" ? "Live reports are kept for a limited time." : "The examples always work."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ExampleLink primary />
              {phase.reason === "not_found" ? (
                <Link href="/start" className="text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
                  Start a new run
                </Link>
              ) : (
                <Button type="button" variant="outline" onClick={retry}>
                  Try again
                </Button>
              )}
            </div>
          </StateCard>
        </StateShell>
      );
    case "done":
      if (failedEarly(phase.report)) {
        const partial = phase.report.partial!;
        return (
          <StateShell>
            <StateCard title="This run didn't finish">
              <p className="text-sm">It stopped while {STAGE_WORDS[partial.stage]?.toLowerCase() ?? partial.stage}.</p>
              <p className="text-xs text-ink-soft">What the run reported: {partial.reason}</p>
              <p className="text-sm text-ink-soft">Nothing was measured yet, so there is no report to show. The examples show what a full run makes.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild>
                  <Link href={EXAMPLE_HREF}>See an example report</Link>
                </Button>
                <Link href="/start" className="text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
                  Try your product again
                </Link>
              </div>
            </StateCard>
          </StateShell>
        );
      }
      return <LiveReportView report={phase.report} runId={runId} actions={actions} />;
  }
}
