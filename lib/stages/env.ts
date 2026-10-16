// What every stage runs with, and the two ways a stage reports: a Qloo call (which becomes a receipt
// in the ledger plus a "tool" trace step) and an agent decision (a "decision" trace step).
import type { Emitter } from "../events";
import type { ReferenceSets } from "../geo/metros";
import type { QlooClient, QlooRequest, QlooResult } from "../qloo/client";
import type { RunContext } from "../qloo/context";
import type { Stage } from "../report/schema";

export interface StageEnv {
  client: QlooClient;
  ctx: RunContext;
  emit: Emitter["emit"];
  /** Reference audiences for city ranking (lib/geo/reference.ts in the app). */
  reference: ReferenceSets;
  /** True when this audience is itself one of the reference audiences (the recorded candidates), so it is left out of the reference. */
  inReference: boolean;
  /** Set on a world's own env (forWorld), so its trace steps group under that world. */
  segmentId?: string;
}

/** The same env for one concept world: its trace steps carry the world's segment id. */
export function forWorld(env: StageEnv, segmentId: string): StageEnv {
  return { ...env, segmentId };
}

const worldOf = (env: StageEnv) => (env.segmentId ? { segmentId: env.segmentId } : {});

/** One Qloo call through the real client, recorded as a receipt and a trace step. Pass `budgetRow` to spend a RUN_BUDGET row. */
export async function qloo<T>(env: StageEnv, stage: Stage, label: string, request: Omit<QlooRequest<T>, "label" | "stage">): Promise<QlooResult<T>> {
  const result = await env.client.request(env.ctx, { ...request, label, stage });
  env.emit({ type: "evidence.added", evidence: result.evidence });
  env.emit({ type: "trace.step", step: { stage, kind: "tool", label, evidenceId: result.evidence.id, cached: result.evidence.cached, ...worldOf(env) } });
  return result;
}

/** An agent decision, shown in the trace with its reason. */
export function decide(env: StageEnv, stage: Stage, label: string, reason?: string): void {
  env.emit({ type: "trace.step", step: { stage, kind: "decision", label, ...(reason ? { reason } : {}), ...worldOf(env) } });
}
