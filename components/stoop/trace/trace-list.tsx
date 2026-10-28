import { Database, Signpost } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { TraceStep } from "@/lib/report/schema";
import { traceRows, type TraceRow, type WorldName } from "@/lib/run/trace";

export interface TraceListProps {
  /** The run's trace: a live ReportState's `trace`, or a recorded Report's. Steps only ever append. */
  steps: readonly TraceStep[];
  /**
   * World names, so steps from worlds running side by side say which world. Pass `{ segmentId, label }`
   * pairs; a state's or a Report's `worlds` also fit, but keep the prop narrow across a client boundary.
   */
  worlds?: readonly WorldName[];
  /** Every Qloo call and decision (default), or the agent's decisions only. */
  show?: "all" | "decisions";
  /** Shows only the newest rows; earlier ones fold behind "Show N earlier steps". */
  recent?: number;
  /** Shown while there are no steps yet. */
  empty?: ReactNode;
  className?: string;
}

/** A trace row of any pipeline: the ad runs' stages (lib/run/trace.ts) or the store-events stages (lib/plan/view). */
export type TraceRowLike = Omit<TraceRow, "stage"> & { stage: string };

/**
 * One step. `folded`: an earlier step, shown only while "Show earlier steps" is open. `firstShown`: the
 * first step shown while folded, which names its stage even mid-run (not again once unfolded).
 */
function Row({ row, folded, firstShown }: { row: TraceRowLike; folded: boolean; firstShown: boolean }) {
  const decision = row.kind === "decision";
  const Icon = decision ? Signpost : Database;
  return (
    <li
      data-trace-step={row.kind}
      className={cn("gap-3 border-b border-hairline py-2.5 last:border-b-0", folded ? "hidden group-has-[[data-earlier-toggle][open]]/trace:flex" : "flex")}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", decision ? "text-ink" : "text-dusk")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {(row.startsGroup || firstShown) && (
          <p
            className={cn(
              "font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase",
              firstShown && !row.startsGroup && "group-has-[[data-earlier-toggle][open]]/trace:hidden",
            )}
          >
            {row.stageLabel}
          </p>
        )}
        <p className={cn("text-sm text-pretty", decision && "font-semibold")}>
          <span className="sr-only">{decision ? "Agent decision: " : "Qloo call: "}</span>
          {row.label}
        </p>
        {(row.world || row.served) && (
          <p className="flex flex-wrap gap-x-2 font-mono text-xs text-ink-soft">
            {row.world && <span>{row.world}</span>}
            {row.served && <span>{row.served === "cached" ? "from cache" : "live call"}</span>}
          </p>
        )}
        {row.reason && (
          <details className="group/why text-sm">
            <summary className="-my-2.5 inline-flex min-h-11 cursor-pointer list-none items-center rounded-sm font-semibold text-ink-soft underline decoration-1 underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden">
              <span className="group-open/why:hidden">Why</span>
              <span className="hidden group-open/why:inline">Hide why</span>
            </summary>
            <p className="mt-1 text-pretty text-ink-soft">{row.reason}</p>
          </details>
        )}
      </div>
    </li>
  );
}

/**
 * The agent's trace as collapsed one-line steps: each Qloo call (from cache or live) and each agent
 * decision with its "Why", in the order they happened, the stage named above each run of steps.
 * No hooks and no client code, so it renders on the server (a recorded replay) or inside a client
 * component (the live /run page), from the same steps.
 *
 * Every step stays in one list under a stable key, so a step keeps its open "Why" as newer steps
 * push it into the folded part; folding is CSS only (the toggle's open state shows the folded rows).
 */
export function TraceList({ steps, worlds = [], show = "all", recent, empty, className }: TraceListProps) {
  return <TraceRowList rows={traceRows(steps, worlds, { show })} recent={recent} empty={empty} className={className} />;
}

/** The same list from rows built elsewhere (the store-events trace, lib/plan/view/plan.ts). */
export function TraceRowList({ rows, recent, empty, className }: { rows: readonly TraceRowLike[]; recent?: number; empty?: ReactNode; className?: string }) {
  if (rows.length === 0) return empty ? <div className={className}>{empty}</div> : null;
  const cut = recent && rows.length > recent ? rows.length - recent : 0;
  return (
    <div className={cn("group/trace flex flex-col", className)} data-trace-list>
      {cut > 0 && (
        <details data-earlier-toggle className="group/earlier border-b border-hairline">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-sm text-sm font-semibold text-ink underline decoration-1 underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open/earlier:hidden">
              Show {cut} earlier {cut === 1 ? "step" : "steps"}
            </span>
            <span className="hidden group-open/earlier:inline">Hide earlier steps</span>
          </summary>
        </details>
      )}
      <ol aria-label="Agent steps">
        {rows.map((row, i) => (
          <Row key={row.key} row={row} folded={i < cut} firstShown={cut > 0 && i === cut} />
        ))}
      </ol>
    </div>
  );
}
