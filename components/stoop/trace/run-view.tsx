"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import { Button } from "@/components/ui/button";
import { useRunEvents } from "@/hooks/use-run-events";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";
import { RUN_CAP } from "@/lib/qloo/budget";
import { formatDate } from "@/lib/report/view/format";
import { callsLine, costLine, formatClock, replayLine, replayProgressLine } from "@/lib/run/format";
import { callCounts, hasEnded, railRows, STAGE_LABELS } from "@/lib/run/rail";
import { browserStorage, markRecent, removeRecent } from "@/lib/run/recents";
import { resultsView } from "@/lib/run/results";
import { EXAMPLE_CHIPS, exampleRunHref, exampleSlugOf, REPLAY_NOTES, reportHref, type ReplayReason } from "@/lib/run/start";
import { RETENTION_LINE } from "@/lib/report/view/retention";
import { ProgressRail } from "./progress-rail";
import { RunResults } from "./run-results";
import { TraceList } from "./trace-list";

type Phase = "connecting" | "running" | "stopped" | "done" | "failed" | "expired" | "unavailable" | "lost";

const TITLES: Record<Phase, string> = {
  connecting: "Building your Campaign Kit",
  running: "Building your Campaign Kit",
  lost: "Building your Campaign Kit",
  stopped: "This run stopped",
  done: "Your Campaign Kit is ready",
  failed: "This run stopped early",
  expired: "That run has expired",
  unavailable: "Live runs are unavailable right now",
};
/** An example replay is the example's kit, not the viewer's. */
const EXAMPLE_TITLES: Partial<Record<Phase, string>> = {
  connecting: "Building the Campaign Kit",
  running: "Building the Campaign Kit",
  lost: "Building the Campaign Kit",
  done: "The Campaign Kit is ready",
};

/** Ticks once a second while `active`; null until the first tick (after mount). */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active]);
  return now;
}

function ExampleLinks({ label = "Open an example report" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{label}</p>
      <ul className="flex flex-wrap gap-2">
        {EXAMPLE_CHIPS.map((chip) => (
          <li key={chip.slug}>
            <Link
              href={`/examples/${chip.slug}`}
              aria-label={`${chip.brandName} example report`}
              className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-concrete-line bg-surface px-4 text-sm font-semibold hover:bg-fill"
            >
              {chip.brandName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * /run/[id]: the live agent trace. The progress rail, the agent's steps with their reasons, the
 * results filling in, the counters and the timer, all from the run's own events (useRunEvents).
 * Every state has something to show: connecting skeletons, a stopped run's Resume, a failed or
 * expired run's examples. Never a blank screen.
 */
export function RunView({ runId, why }: { runId: string; why: ReplayReason | null }) {
  const run = useRunEvents(runId);
  const router = useRouter();
  const { state, events, stream, problem } = run;
  const exampleSlug = exampleSlugOf(runId);
  const isExample = exampleSlug !== null;
  const ended = hasEnded(state);
  const failed = state.status === "failed" || stream?.status === "failed";

  let phase: Phase;
  if (problem?.kind === "expired") phase = "expired";
  else if (failed) phase = "failed";
  else if (ended || stream?.status === "done") phase = "done";
  else if (problem?.kind === "unavailable") phase = "unavailable";
  else if (problem?.kind === "lost") phase = "lost";
  else if (stream?.status === "stopped") phase = "stopped";
  else if (state.runId) phase = "running";
  else phase = "connecting";

  const over = phase === "done" || phase === "failed";
  const rows = useMemo(() => railRows(events, { ended: over, failed: phase === "failed" }), [events, over, phase]);
  const calls = useMemo(() => callCounts(state.trace), [state.trace]);
  const results = useMemo(() => resultsView(state), [state]);
  const worlds = useMemo(() => state.worlds.map((w) => ({ segmentId: w.segmentId, label: w.label })), [state.worlds]);

  // "Recent campaigns" follows the run: ready, stopped or failed; an expired one leaves the list.
  useEffect(() => {
    if (isExample) return;
    const storage = browserStorage("localStorage");
    if (phase === "done") markRecent(storage, runId, "ready");
    else if (phase === "stopped") markRecent(storage, runId, "stopped");
    else if (phase === "failed") markRecent(storage, runId, "failed");
    else if (phase === "expired") removeRecent(storage, runId);
  }, [phase, isExample, runId]);

  // The timer: a live run's own clock (its start, then its cost or last event); an example replay's time in this view.
  const ticking = phase === "running" || phase === "connecting";
  const now = useNow(ticking);
  const lastAt = events.length ? Date.parse(events[events.length - 1].at) : null;
  const start = isExample ? run.openedAt : state.startedAt ? Date.parse(state.startedAt) : null;
  const end = isExample ? run.endedAt : state.cost && start !== null ? start + state.cost.durationMs : ticking ? null : lastAt;
  const elapsed = start === null ? 0 : (end ?? now ?? start) - start;

  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const onResume = async () => {
    setResuming(true);
    setResumeError(null);
    const outcome = await run.resume();
    setResuming(false);
    if (outcome.kind === "example") router.push(exampleRunHref(outcome.slug, outcome.reason));
    else if (outcome.kind === "error") setResumeError(outcome.message);
  };

  const product = state.inputs?.product;
  const current = rows.filter((row) => row.status === "current").map((row) => row.label);
  const subtitle =
    phase === "expired"
      ? `${problem!.message} ${RETENTION_LINE}`
      : phase === "unavailable"
        ? problem!.message
        : product
          ? isExample
            ? `A recorded run for ${product.brandName ? `${product.brandName}'s ${product.name}` : product.name}, replayed step by step.`
            : `Mapping the taste neighborhood around ${product.name}.`
          : "Each Qloo call and agent decision shows up here as it happens.";
  const title = (isExample ? EXAMPLE_TITLES[phase] : undefined) ?? TITLES[phase];
  const announce =
    phase === "done"
      ? `${title}.`
      : phase === "running" && current.length
        ? `Working on ${current.join(" and ")}.`
        : phase === "stopped"
          ? "This run stopped. You can resume it."
          : phase === "failed"
            ? "This run stopped early."
            : "";

  // Examples show recorded counts, never a live budget; a live run's calls count against its cap.
  const counts = isExample ? (over ? replayLine(calls) : replayProgressLine(calls)) : over ? (state.cost ? costLine(state.cost) : callsLine(calls, RUN_CAP)) : callsLine(calls, RUN_CAP);
  const statusLine = over ? counts : `${isExample ? "Replaying" : "Working"} ${formatClock(elapsed)} · ${counts}${run.connection === "reconnecting" ? " · Reconnecting…" : ""}`;
  const showTrace = phase !== "expired" && phase !== "unavailable";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 pt-8 pb-20 sm:px-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          {(isExample || state.partial) && (
            <div className="flex flex-wrap items-center gap-2">
              {isExample && <ProvenanceBadge kind="recorded" date={state.startedAt ? formatDate(state.startedAt) : undefined} />}
              {state.partial && <ProvenanceBadge kind="partial" />}
            </div>
          )}
          <h1 className="font-display text-[1.625rem] leading-tight font-extrabold text-balance [font-stretch:85%] sm:text-[1.875rem]">{title}</h1>
          <p className="max-w-[62ch] text-sm text-pretty text-ink-soft">{subtitle}</p>
        </div>
        {phase === "done" && (
          <Button asChild className="self-start sm:self-auto">
            <Link href={reportHref(runId)}>{isExample ? "Open the Campaign Kit" : "Open your Campaign Kit"}</Link>
          </Button>
        )}
        {phase === "stopped" && stream?.resumable && (
          <Button type="button" onClick={onResume} disabled={resuming} className="self-start sm:self-auto">
            {resuming ? "Resuming…" : "Resume"}
          </Button>
        )}
        {phase === "lost" && (
          <Button type="button" onClick={run.retry} className="self-start sm:self-auto">
            Try again
          </Button>
        )}
      </header>

      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>

      {isExample && why && (
        <p className="flex items-start gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-soft" />
          {REPLAY_NOTES[why]}
        </p>
      )}
      {phase === "stopped" && (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm">
          <p>
            {stream?.resumable
              ? "It stopped before it finished. Resume picks up after the last finished step, so the Qloo calls it already made are not spent again."
              : "It stopped before it finished."}
          </p>
          {resumeError && (
            <p role="alert" className="font-semibold">
              {resumeError}
            </p>
          )}
          <Link href={exampleRunHref(LEAD_EXAMPLE.slug)} className="self-start font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
            Watch an example run instead
          </Link>
        </div>
      )}
      {phase === "lost" && <p className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm">{problem?.message}</p>}
      {phase === "done" && state.partial && (
        <p className="rounded-xl border border-hairline bg-surface px-4 py-3 text-sm">
          Partial data: {STAGE_LABELS[state.partial.stage]} did not finish ({state.partial.reason}). The report shows everything that was measured.
        </p>
      )}
      {phase === "failed" && (
        <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 text-sm">
          <p>{state.error ?? "The run stopped before it finished."} What it measured before it stopped is below.</p>
          {!isExample && (
            <Link href={reportHref(runId)} className="self-start font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
              Open the partial report
            </Link>
          )}
          <ExampleLinks label="See a full run instead" />
        </div>
      )}
      {(phase === "expired" || phase === "unavailable") && (
        <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 text-sm sm:p-5">
          {/* A live run's trace is kept for fewer days than its report, which may still be there. */}
          {phase === "expired" && !isExample && (
            <Link href={reportHref(runId)} className="self-start font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
              Open the report
            </Link>
          )}
          <p>The examples show a full run: the Reality Check, the concept worlds and the Campaign Kit.</p>
          <ExampleLinks />
          <Link href="/ads/start" className="self-start font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
            Start a new run
          </Link>
        </div>
      )}

      {showTrace && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-x-8 lg:gap-y-5">
          <div className="flex flex-col gap-3 lg:col-start-1 lg:row-start-1">
            <ProgressRail rows={rows} />
            <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 font-mono text-xs text-ink-soft" data-run-status>
              {statusLine}
            </p>
          </div>

          <section aria-labelledby="run-results" className="flex min-w-0 flex-col gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <h2 id="run-results" className="text-sm font-semibold">
              {over ? "Results" : "Results so far"}
            </h2>
            <RunResults view={results} running={!over} />
          </section>

          <section aria-labelledby="run-trace" className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2">
            <h2 id="run-trace" className="font-mono text-xs font-medium tracking-wide text-ink-soft uppercase">
              Agent at work
            </h2>
            <div className="rounded-xl border border-hairline bg-surface px-4">
              <TraceList
                steps={state.trace}
                worlds={worlds}
                recent={8}
                empty={<p className="py-3 text-sm text-ink-soft">{phase === "connecting" ? "Connecting to the run…" : "Waiting for the first step…"}</p>}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
