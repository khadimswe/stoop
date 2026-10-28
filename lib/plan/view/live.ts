// A live plan in the browser: what the progress rail shows, and how to read the plan routes' answers.
// Pure and client-safe; the hook in components/stoop/plan/use-plan-events.ts wires it to EventSource.
import { planEventSchema, type PlanEvent, type PlanState } from "../events";
import { PLAN_STAGES, planReportSchema, type PlanReport, type PlanStage } from "../schema";
import { PLAN_STAGE_LABELS } from "./format";

export type RailStatus = "done" | "current" | "pending" | "stopped";

export interface PlanRailRow {
  stage: PlanStage;
  label: string;
  status: RailStatus;
  calls: { live: number; cached: number };
}

/**
 * The stages a run goes through, each done, in progress, waiting or stopped, with the Qloo calls its
 * trace steps made. Marketing runs after the plan, so it is left out until it starts.
 */
export function railRows(state: Pick<PlanState, "status" | "current" | "report">): PlanRailRow[] {
  const { stats, trace, partial } = state.report;
  const ended = state.status === "done" || state.status === "failed" || state.status === "partial";
  const stages = PLAN_STAGES.filter((s) => s !== "marketing" || stats.stages.marketing || state.current === "marketing");
  return stages.map((stage) => {
    const calls = { live: 0, cached: 0 };
    for (const step of trace) if (step.stage === stage && step.kind === "tool") calls[step.cached ? "cached" : "live"]++;
    const status: RailStatus = stats.stages[stage]
      ? "done"
      : state.current === stage
        ? "current"
        : ended || partial?.stage === stage
          ? "stopped"
          : "pending";
    return { stage, label: PLAN_STAGE_LABELS[stage], status, calls };
  });
}

/** True for the events after which the run's own stream has nothing more to send. */
export function endsRun(event: PlanEvent): boolean {
  return event.type === "run.done" || event.type === "run.failed";
}

/** One server-sent message as a plan event, or null for anything else (keep-alives, other shapes). */
export function parsePlanEvent(data: string): PlanEvent | null {
  try {
    const parsed = planEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/plan/[id], read whichever way it answers: the report itself, `{ report }`, or
 * `{ events }`. Null when it is none of those.
 */
export function readPlanResponse(body: unknown): { report: PlanReport } | { events: PlanEvent[] } | null {
  if (!body || typeof body !== "object") return null;
  const direct = planReportSchema.safeParse(body);
  if (direct.success) return { report: direct.data };
  const b = body as Record<string, unknown>;
  if (b.report) {
    const nested = planReportSchema.safeParse(b.report);
    if (nested.success) return { report: nested.data };
  }
  if (Array.isArray(b.events)) {
    const events = b.events.map((e) => planEventSchema.safeParse(e)).flatMap((r) => (r.success ? [r.data] : []));
    if (events.length > 0) return { events };
  }
  return null;
}
