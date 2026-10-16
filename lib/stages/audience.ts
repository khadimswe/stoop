// The audience half of a run: Prove, then the Reality Check, then Segments, emitted as run events.
// The same function serves live runs (Gate 5 wraps it with Redis and after()) and recorded example
// runs (replayed from fixtures). Nothing here reads a clock directly: the emitter stamps events and
// `now` times the stages, so a recorded run is reproducible byte for byte.
import type { Evidence } from "../evidence";
import type { Emitter } from "../events";
import type { QlooClient } from "../qloo/client";
import type { RunContext } from "../qloo/context";
import type { ReferenceSets } from "../geo/metros";
import type { RunInputs, Stage } from "../report/schema";
import type { StageEnv } from "./env";
import { realityCheck, type GenericAssumption, type StatedAudience } from "./gap";
import { prove } from "./prove";
import { segments } from "./segments";

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

export async function runAudience(env: AudienceEnv, run: AudienceRun): Promise<void> {
  const { emit } = env.emitter;
  const stageEnv: StageEnv = { client: env.client, ctx: env.ctx, emit, reference: env.reference, inReference: env.inReference };
  emit({ type: "run.started", runId: run.runId, kind: run.kind, inputs: run.inputs });
  for (const evidence of run.seedEvidence) emit({ type: "evidence.added", evidence });

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

  try {
    const proved = await timed("prove", () => prove(stageEnv, { seeds: run.inputs.seeds, region: run.inputs.region }));
    if ("partial" in proved) {
      emit({ type: "run.partial", stage: "prove", reason: proved.partial });
      emit({ type: "run.done" });
      return;
    }
    const { proof } = proved;
    emit({ type: "audience.proof", proof });

    const gap = await timed("gap", () =>
      realityCheck(stageEnv, { seeds: run.inputs.seeds, proof, stated: run.stated, site: run.site, generic: run.generic }),
    );
    emit({ type: "audience.gap", gap });

    const worlds = await timed("segments", () =>
      segments(stageEnv, { seeds: run.inputs.seeds, proof, region: run.inputs.region, parentHeatmap: proved.heatmap }),
    );
    emit({ type: "audience.segments", segments: worlds });
    emit({ type: "run.done" });
  } catch (error) {
    emit({ type: "run.failed", stage: current, message: error instanceof Error ? error.message : String(error) });
  }
}
