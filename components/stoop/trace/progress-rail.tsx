import { Check, Pause } from "lucide-react";
import { cn } from "cn";
import type { RailRow, RailStatus } from "@/lib/run/rail";

const SPOKEN: Record<RailStatus, string> = { done: "Done", current: "In progress", pending: "Waiting", stopped: "Stopped" };

function StatusIcon({ status }: { status: RailStatus }) {
  if (status === "done")
    return (
      <span aria-hidden="true" className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-full bg-ink">
        <Check className="size-3 text-paper" strokeWidth={3.2} />
      </span>
    );
  if (status === "current")
    // A turning ring; under reduced motion it stays still, with a dot so it never reads as empty.
    return (
      <span aria-hidden="true" className="relative flex size-[1.125rem] shrink-0 items-center justify-center">
        <span className="absolute inset-0.5 rounded-full border-[2.5px] border-dusk border-r-transparent motion-safe:animate-spin" />
        <span className="size-1.5 rounded-full bg-dusk motion-safe:hidden" />
      </span>
    );
  if (status === "stopped")
    return (
      <span aria-hidden="true" className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink">
        <Pause className="size-2.5 text-ink" strokeWidth={3} />
      </span>
    );
  return <span aria-hidden="true" className="m-0.5 size-3.5 shrink-0 rounded-full border-[1.5px] border-concrete-line" />;
}

/** A rail row of any pipeline: the ad runs' stages or the store-events stages. */
export type RailRowLike = Omit<RailRow, "stage"> & { stage: string };

function callsText(row: RailRowLike): string {
  const total = row.calls.live + row.calls.cached;
  if (row.status === "pending" || total === 0) return "";
  return `${total} Qloo ${total === 1 ? "call" : "calls"}`;
}

/**
 * The run's stages with done, in progress, waiting or stopped, each with the Qloo calls its steps
 * made. Worlds run side by side, so two stages can be in progress at once.
 */
export function ProgressRail({ rows, className }: { rows: readonly RailRowLike[]; className?: string }) {
  return (
    <ol aria-label="Progress" className={cn("overflow-hidden rounded-xl border border-hairline bg-surface", className)}>
      {rows.map((row) => (
        <li
          key={row.stage}
          data-stage={row.stage}
          data-status={row.status}
          aria-current={row.status === "current" ? "step" : undefined}
          className={cn("flex min-h-11 items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0", row.status === "current" && "bg-fill")}
        >
          <StatusIcon status={row.status} />
          <span className={cn("flex-1 text-sm", row.status === "pending" ? "text-ink-soft" : "text-ink", row.status === "current" && "font-semibold")}>
            <span className="sr-only">{SPOKEN[row.status]}: </span>
            {row.label}
          </span>
          <span className="font-mono text-xs text-ink-soft">{callsText(row)}</span>
        </li>
      ))}
    </ol>
  );
}
