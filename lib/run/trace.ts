// The agent trace as one-line rows: each Qloo call and each agent decision, in the order they
// happened, with the stage they belong to and, while worlds run side by side, which world. Pure and
// client-safe, so the live /run page and a recorded replay render the same rows.
import { CONTROL_SEGMENT } from "../api/requests";
import type { TraceStep } from "../report/schema";
import type { TraceStage } from "../report/stages";
import { STAGE_LABELS } from "./rail";

export interface TraceRow {
  /** Position in the trace: steps only ever append, so it is stable while a run streams. */
  key: string;
  stage: TraceStage;
  stageLabel: string;
  /** First row of a run of rows in one stage: the list names the stage above it. */
  startsGroup: boolean;
  kind: TraceStep["kind"];
  label: string;
  /** Why the agent decided this (decisions only). */
  reason: string | null;
  /** Tool steps: whether the answer came from cache or a live Qloo call. */
  served: "cached" | "live" | null;
  /** The world a step belongs to, by its short label ("55 and older"), or "Control". */
  world: string | null;
  evidenceId: string | null;
}

export interface WorldName {
  segmentId: string;
  label: string;
}

/** "55 and older · rock and classic rock" reads "55 and older" in a trace row. */
export function shortWorldLabel(label: string): string {
  return label.split(" · ")[0].trim() || label;
}

export function traceRows(steps: readonly TraceStep[], worlds: readonly WorldName[] = [], options: { show?: "all" | "decisions" } = {}): TraceRow[] {
  const names = new Map(worlds.map((w) => [w.segmentId, shortWorldLabel(w.label)]));
  const rows: TraceRow[] = [];
  steps.forEach((step, index) => {
    if (options.show === "decisions" && step.kind !== "decision") return;
    const previous = rows.at(-1);
    rows.push({
      key: String(index),
      stage: step.stage,
      stageLabel: STAGE_LABELS[step.stage],
      startsGroup: !previous || previous.stage !== step.stage,
      kind: step.kind,
      label: step.label,
      reason: step.reason?.trim() || null,
      served: step.kind === "tool" ? (step.cached ? "cached" : "live") : null,
      world: step.segmentId ? (step.segmentId === CONTROL_SEGMENT ? "Control" : (names.get(step.segmentId) ?? null)) : null,
      evidenceId: step.evidenceId ?? null,
    });
  });
  return rows;
}
