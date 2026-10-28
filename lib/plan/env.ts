// What every plan stage runs with, and the two ways a stage reports, as in Stoop's run stages
// (lib/stages/env.ts): a Qloo call (a receipt in the ledger plus a "tool" trace step) and an agent
// decision (a "decision" trace step).
import type { LanguageModel } from "ai";
import type { PlanBudgetRow } from "../qloo/budget";
import type { QlooClient, QlooRequest, QlooResult } from "../qloo/client";
import type { RunContext } from "../qloo/context";
import type { PlanEvent, PlanEventInput } from "./events";
import type { PlanStage } from "./schema";

export interface PlanSink {
  emit(input: PlanEventInput): PlanEvent;
}

export interface PlanEnv {
  client: QlooClient;
  ctx: RunContext;
  sink: PlanSink;
  model: LanguageModel;
  abortSignal?: AbortSignal;
  /** Per Claude call; the plan's calls are short, so the default is under the run's deadline. */
  timeoutMs?: number;
}

/** The budget row each stage spends from (lib/qloo/budget.ts PLAN_BUDGET). */
export const PLAN_STAGE_ROWS: Partial<Record<PlanStage, PlanBudgetRow>> = { city: "planCity", block: "planBlock" };

/** One Qloo call through the real client, recorded as a receipt and a trace step. */
export async function planQloo<T>(
  env: PlanEnv,
  stage: PlanStage,
  label: string,
  request: Omit<QlooRequest<T>, "label" | "stage" | "budgetRow"> & { budgetRow?: PlanBudgetRow },
  reason?: string,
): Promise<QlooResult<T>> {
  const budgetRow = request.budgetRow ?? PLAN_STAGE_ROWS[stage];
  const result = await env.client.request(env.ctx, { ...request, label, stage, ...(budgetRow ? { budgetRow } : {}) });
  env.sink.emit({ type: "evidence.added", evidence: result.evidence });
  env.sink.emit({ type: "trace.step", step: { stage, kind: "tool", label, evidenceId: result.evidence.id, cached: result.evidence.cached, ...(reason ? { reason } : {}) } });
  return result;
}

/** An agent decision, shown in the trace with its reason. */
export function planDecide(env: Pick<PlanEnv, "sink">, stage: PlanStage, label: string, reason?: string): void {
  env.sink.emit({ type: "trace.step", step: { stage, kind: "decision", label, ...(reason ? { reason } : {}) } });
}
