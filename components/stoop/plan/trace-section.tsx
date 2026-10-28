import type { PlanTraceRow } from "@/lib/plan/view/plan";
import { TraceRowList } from "../trace/trace-list";
import { Card, PlanSection } from "./plan-section";

/** Every Qloo call and agent decision behind the plan, in order, each decision with its "Why". */
export function TraceSection({ rows, calls, live }: { rows: readonly PlanTraceRow[]; calls: { live: number; cached: number }; live?: boolean }) {
  const total = calls.live + calls.cached;
  return (
    <PlanSection
      id="trace"
      kicker="How Stoop built this"
      title="The agent's steps"
      description={total > 0 ? `${total} Qloo ${total === 1 ? "call" : "calls"}: ${calls.live} live, ${calls.cached} from cache.` : undefined}
    >
      <Card className="py-2 sm:py-3">
        <TraceRowList rows={rows} recent={live ? undefined : 12} empty={<p className="py-2 text-sm text-ink-soft">{live ? "Starting..." : "No steps recorded."}</p>} />
      </Card>
    </PlanSection>
  );
}
