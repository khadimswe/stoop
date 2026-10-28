import type { PlanTraceRow } from "@/lib/plan/view/plan";
import { TraceRowList } from "../trace/trace-list";
import { Disclosure } from "./disclosure";

/** Every Qloo call and agent decision behind the plan, closed by default: mainly for judges. */
export function TraceSection({ rows, calls, live }: { rows: readonly PlanTraceRow[]; calls: { live: number; cached: number }; live?: boolean }) {
  const total = calls.live + calls.cached;
  return (
    <Disclosure id="how-it-was-made" title="How it was made" meta={total > 0 ? `${total} Qloo calls` : undefined} defaultOpen={live}>
      <TraceRowList rows={rows} empty={<p className="py-2 text-sm text-ink-soft">{live ? "Starting..." : "No steps recorded."}</p>} />
    </Disclosure>
  );
}
