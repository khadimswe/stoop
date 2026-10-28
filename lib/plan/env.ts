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
  /** Normalized names the recorded runs found on more than one store's block: marked as chains (lib/plan/taste.ts). */
  knownChains?: ReadonlySet<string>;
  /** When the run must be done (epoch ms). Each Claude call fits inside it, and a stage with no time left uses its plain fallback. */
  deadlineAt?: number;
  now?: () => number;
}

/** Time kept after the last Claude call for the Qloo checks and the writes. */
export const DEADLINE_RESERVE_MS = 20_000;
/** A Claude call gets at least this long, or it is skipped for the stage's fallback. */
export const MIN_CLAUDE_MS = 15_000;

/**
 * How long the next Claude call may take: its stage's own limit, cut to what the run's deadline leaves.
 * Null when there is not enough time left, so the stage uses its plain fallback instead of failing.
 */
export function claudeTimeout(env: Pick<PlanEnv, "deadlineAt" | "now" | "timeoutMs">, stageMs: number): number | null {
  const limit = env.timeoutMs ?? stageMs;
  if (env.deadlineAt === undefined) return limit;
  const left = env.deadlineAt - (env.now ?? Date.now)() - DEADLINE_RESERVE_MS;
  return left < MIN_CLAUDE_MS ? null : Math.min(limit, left);
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
