// The live run's progress rail and call counters, from the run's own events. Client-safe: it reads
// event and trace types only, plus the stage list.
import type { RunEvent, RunStatus } from "../events";
import type { TraceStep } from "../report/schema";
import { STAGES, type Stage, type TraceStage } from "../report/stages";

/**
 * The rail, in the order a run reaches each stage: each world's picks are scored against the
 * reference panels (the cliche check) before its concepts are written. The same stages as STAGES.
 */
export const RAIL: readonly Stage[] = ["prove", "gap", "segments", "culture", "score", "concepts", "prompts"];

/** What each stage is called on screen: the trace's group headings and the rail rows. */
export const STAGE_LABELS: Readonly<Record<TraceStage, string>> = {
  prove: "Taste neighborhood",
  gap: "Reality Check",
  segments: "Concept worlds",
  culture: "Culture Briefs",
  score: "Cliche check",
  concepts: "Concepts",
  prompts: "Production Pack",
  frames: "Storyboard frames",
  revise: "Revisions",
};

export type RailStatus = "done" | "current" | "pending" | "stopped";

export interface CallCount {
  live: number;
  cached: number;
}

export interface RailRow {
  stage: Stage;
  label: string;
  status: RailStatus;
  /** Qloo calls this stage's steps made so far (trace tool steps under this stage). */
  calls: CallCount;
}

const IN_RUN = new Set<string>(STAGES);

/**
 * Qloo calls the run made, counted from its tool steps (one per call, the same tally the stage stats
 * come from). Frames and revisions come after the run, on their own caps, so they are left out.
 */
export function callCounts(trace: readonly TraceStep[]): CallCount {
  const count: CallCount = { live: 0, cached: 0 };
  for (const step of trace) {
    if (step.kind !== "tool" || !IN_RUN.has(step.stage)) continue;
    if (step.cached) count.cached++;
    else count.live++;
  }
  return count;
}

/** True once a run has ended: done, failed, or partial with no stage left running. */
export function hasEnded(state: { status: RunStatus; stage: Stage | null }): boolean {
  return state.status === "done" || state.status === "failed" || (state.status === "partial" && state.stage === null);
}

/**
 * Each stage's status, from its stage events. Worlds and the Control run stages side by side, so a
 * stage is open while any of them is in it. A stage whose scopes have all finished is done once a
 * later stage has started (or the run ended); until then it is still current, since another world
 * may enter it next. A failed run marks where it stopped: what was still open, or the last stage it
 * reached.
 */
export function railRows(events: readonly RunEvent[], run: { ended: boolean; failed: boolean }): RailRow[] {
  /** Stages with their own stage events. */
  const started = new Set<Stage>();
  /** Stages whose steps have arrived (a stage's work can show up before its stage events, as the generic brief's scoring does). */
  const stepped = new Set<Stage>();
  const open = new Map<Stage, Set<string>>();
  const calls = new Map<Stage, CallCount>(RAIL.map((stage) => [stage, { live: 0, cached: 0 }]));
  for (const event of events) {
    if (event.type === "stage.started") {
      started.add(event.stage);
      const scopes = open.get(event.stage) ?? new Set<string>();
      scopes.add(event.segmentId ?? "run");
      open.set(event.stage, scopes);
    } else if (event.type === "stage.done") {
      started.add(event.stage);
      open.get(event.stage)?.delete(event.segmentId ?? "run");
    } else if (event.type === "trace.step" && IN_RUN.has(event.step.stage)) {
      stepped.add(event.step.stage as Stage);
      if (event.step.kind !== "tool") continue;
      const count = calls.get(event.step.stage as Stage)!;
      if (event.step.cached) count.cached++;
      else count.live++;
    }
  }
  const over = (): RailStatus => (run.failed ? "stopped" : "done");
  return RAIL.map((stage, index) => {
    const isOpen = (open.get(stage)?.size ?? 0) > 0;
    // Done needs a later stage's own events: steps alone never close an earlier stage, so no row flickers back.
    const laterStarted = RAIL.slice(index + 1).some((later) => started.has(later));
    let status: RailStatus;
    if (!started.has(stage) && !stepped.has(stage)) status = "pending";
    else if (isOpen) status = run.ended ? over() : "current";
    else if (!started.has(stage)) status = run.ended ? over() : "current";
    else if (laterStarted) status = "done";
    else status = run.ended ? over() : "current";
    return { stage, label: STAGE_LABELS[stage], status, calls: calls.get(stage)! };
  });
}
