// The audience half of a run: Prove, then the Reality Check, then Segments, emitted as run events.
// The same function serves live runs (Gate 5 wraps it with Redis and after()) and recorded example
// runs (replayed from fixtures). Nothing here reads a clock directly: the emitter stamps events and
// `now` times the stages, so a recorded run is reproducible byte for byte.
import type { Evidence } from "../evidence";
import type { Emitter } from "../events";
import type { QlooClient } from "../qloo/client";
import type { RunContext } from "../qloo/context";
import type { ReferenceSets } from "../geo/metros";
import type { HeatmapCell } from "../qloo/types";
import type { Proof, RealityCheck, RunInputs, Segments, Stage } from "../report/schema";
import type { StageEnv } from "./env";
import { realityCheck, type GenericAssumption, type StatedAudience } from "./gap";
import { prove } from "./prove";
import { segments, type SegmentRaw } from "./segments";

export interface AudienceRun {
  runId: string;
  kind: "live" | "example";
  inputs: RunInputs;
  /** The founder's stated customer, read in Qloo's dimensions (statedFromText or intake's site reading). */
  stated: StatedAudience | null;
  /** Claude's reading of the founder's site, when there is one. Never origin qloo. */
  site: StatedAudience | null;
  /** What the LLM-only Control brief assumed, when it has run. */
  generic: GenericAssumption | null;
  /** Receipts for how the seeds were resolved before the run (search or autocomplete). */
  seedEvidence: readonly Evidence[];
}

export interface AudienceEnv {
  client: QlooClient;
  ctx: RunContext;
  emitter: Emitter;
  reference: ReferenceSets;
  inReference: boolean;
  /** Milliseconds, for stage durations. */
  now: () => number;
}

/** Times one stage as stage.started and stage.done events, with its calls. Shared by every stage runner. */
export function stageTimer(env: Pick<AudienceEnv, "ctx" | "emitter" | "now">) {
  const { emit } = env.emitter;
  let current: Stage = "prove";
  const timed = async <T>(stage: Stage, work: () => Promise<T>): Promise<T> => {
    current = stage;
    emit({ type: "stage.started", stage });
    const started = env.now();
    const live = env.ctx.liveCalls;
    const cached = env.ctx.cachedCalls;
    const result = await work();
    emit({
      type: "stage.done",
      stage,
      stats: { durationMs: env.now() - started, liveCalls: env.ctx.liveCalls - live, cachedCalls: env.ctx.cachedCalls - cached },
    });
    return result;
  };
  return { timed, current: () => current };
}

/** What the audience stages measured, including what the report leaves out but Culture needs. */
export interface MeasuredAudience {
  proof: Proof;
  /** Prove's heatmap, left out of the reference when ranking a segment (it shares its parent's signal). */
  heatmap: HeatmapCell[];
  gap: RealityCheck;
  segments: Segments;
  raw: Map<string, SegmentRaw>;
}

/** Prove, then the Reality Check, then Segments, emitting their results. Partial when Prove can't run. */
export async function measureAudience(
  stageEnv: StageEnv,
  run: AudienceRun,
  timed: ReturnType<typeof stageTimer>["timed"],
): Promise<MeasuredAudience | { partial: string }> {
  const { emit } = stageEnv;
  const proved = await timed("prove", () => prove(stageEnv, { seeds: run.inputs.seeds, region: run.inputs.region }));
  if ("partial" in proved) return { partial: proved.partial };
  const { proof } = proved;
  emit({ type: "audience.proof", proof });

  const gap = await timed("gap", () => realityCheck(stageEnv, { seeds: run.inputs.seeds, proof, stated: run.stated, site: run.site, generic: run.generic }));
  emit({ type: "audience.gap", gap });

  const measured = await timed("segments", () => segments(stageEnv, { seeds: run.inputs.seeds, proof, region: run.inputs.region, parentHeatmap: proved.heatmap }));
  emit({ type: "audience.segments", segments: measured.segments });
  return { proof, heatmap: proved.heatmap, gap, segments: measured.segments, raw: measured.raw };
}

export async function runAudience(env: AudienceEnv, run: AudienceRun): Promise<void> {
  const { emit } = env.emitter;
  const stageEnv: StageEnv = { client: env.client, ctx: env.ctx, emit, reference: env.reference, inReference: env.inReference };
  emit({ type: "run.started", runId: run.runId, kind: run.kind, inputs: run.inputs });
  for (const evidence of run.seedEvidence) emit({ type: "evidence.added", evidence });
  const timer = stageTimer(env);
  try {
    const measured = await measureAudience(stageEnv, run, timer.timed);
    if ("partial" in measured) emit({ type: "run.partial", stage: "prove", reason: measured.partial });
    emit({ type: "run.done" });
  } catch (error) {
    emit({ type: "run.failed", stage: timer.current(), message: error instanceof Error ? error.message : String(error) });
  }
}
