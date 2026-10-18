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

function Row({ row }: { row: TraceRow }) {
  const decision = row.kind === "decision";
  const Icon = decision ? Signpost : Database;
  return (
    <li data-trace-step={row.kind} className="flex gap-3 border-b border-hairline py-2.5 last:border-b-0">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", decision ? "text-ink" : "text-dusk")} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {row.startsGroup && <p className="font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">{row.stageLabel}</p>}
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
 */
export function TraceList({ steps, worlds = [], show = "all", recent, empty, className }: TraceListProps) {
  const rows = traceRows(steps, worlds, { show });
  if (rows.length === 0) return empty ? <div className={className}>{empty}</div> : null;
  const cut = recent && rows.length > recent ? rows.length - recent : 0;
  const earlier = rows.slice(0, cut);
  const latest = rows.slice(cut);
  return (
    <div className={cn("flex flex-col", className)} data-trace-list>
      {earlier.length > 0 && (
        <details className="group/earlier border-b border-hairline">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-sm text-sm font-semibold text-ink underline decoration-1 underline-offset-4 [&::-webkit-details-marker]:hidden">
            <span className="group-open/earlier:hidden">
              Show {earlier.length} earlier {earlier.length === 1 ? "step" : "steps"}
            </span>
            <span className="hidden group-open/earlier:inline">Hide earlier steps</span>
          </summary>
          <ol aria-label="Earlier steps">
            {earlier.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ol>
        </details>
      )}
      <ol aria-label={earlier.length > 0 ? "Latest steps" : "Agent steps"}>
        {latest.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ol>
    </div>
  );
}
