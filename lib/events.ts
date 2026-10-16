// Run events: one zod schema and one reducer for live SSE, finished-run replays and example
// replays. Stages emit events; the UI and the stored report are both built by `reduce`, so a stored
// run replays to exactly the report it produced (the golden test).
import { z } from "zod";
import { evidenceSchema, type Evidence } from "./evidence";
import {
  gapSchema,
  inputsSchema,
  proofSchema,
  REPORT_VERSION,
  reportSchema,
  segmentsSchema,
  stageSchema,
  stageStatsSchema,
  traceStepSchema,
  type Report,
  type Stage,
} from "./report/schema";

const base = { seq: z.number().int().nonnegative(), at: z.iso.datetime() };

export const runEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("run.started"), runId: z.string().min(1), kind: z.enum(["live", "example"]), inputs: inputsSchema }),
  z.strictObject({ ...base, type: z.literal("stage.started"), stage: stageSchema }),
  z.strictObject({ ...base, type: z.literal("stage.done"), stage: stageSchema, stats: stageStatsSchema }),
  z.strictObject({ ...base, type: z.literal("trace.step"), step: traceStepSchema }),
  z.strictObject({ ...base, type: z.literal("evidence.added"), evidence: evidenceSchema }),
  z.strictObject({ ...base, type: z.literal("audience.proof"), proof: proofSchema }),
  z.strictObject({ ...base, type: z.literal("audience.gap"), gap: gapSchema }),
  z.strictObject({ ...base, type: z.literal("audience.segments"), segments: segmentsSchema }),
  z.strictObject({ ...base, type: z.literal("run.partial"), stage: stageSchema, reason: z.string().min(1) }),
  z.strictObject({ ...base, type: z.literal("run.done") }),
  z.strictObject({ ...base, type: z.literal("run.failed"), stage: stageSchema.nullable(), message: z.string().min(1) }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;
/** An event before the emitter stamps `seq` and `at`. */
export type RunEventInput = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "seq" | "at"> : never) : never;

export type RunStatus = "idle" | "running" | "done" | "partial" | "failed";

/** The report so far, plus where the run is. A finished run's state converts to a Report. */
export interface ReportState {
  status: RunStatus;
  stage: Stage | null;
  /** Highest seq applied, for resuming a stream (SSE Last-Event-ID). */
  lastSeq: number;
  /** Every seq applied, so a late event (lower seq, not yet seen) still applies and a repeat never does. */
  seen: readonly number[];
  runId: string | null;
  kind: "live" | "example" | null;
  startedAt: string | null;
  inputs: Report["inputs"] | null;
  ledger: Evidence[];
  audience: Report["audience"];
  trace: Report["trace"];
  stats: Report["stats"];
  partial: Report["partial"];
  error: string | null;
}

export const initialState: ReportState = {
  status: "idle",
  stage: null,
  lastSeq: -1,
  seen: [],
  runId: null,
  kind: null,
  startedAt: null,
  inputs: null,
  ledger: [],
  audience: { proof: null, gap: null, segments: null },
  trace: [],
  stats: { stages: {} },
  partial: null,
  error: null,
};

const TERMINAL: readonly RunStatus[] = ["done", "partial", "failed"];

/**
 * Applies one event. A repeat (same seq, e.g. an SSE reconnect) changes nothing; a late event with a
 * lower, unseen seq still applies. Once a run ended (done or failed), nothing else changes it, and
 * a second run.started never replaces the first.
 */
export function apply(state: ReportState, event: RunEvent): ReportState {
  if (state.seen.includes(event.seq)) return state;
  const ended = state.status === "done" || state.status === "failed" || (state.status === "partial" && state.stage === null);
  if (ended && event.seq > state.lastSeq) return state;
  if (event.type === "run.started" && state.runId !== null) return state;
  const next: ReportState = { ...state, lastSeq: Math.max(state.lastSeq, event.seq), seen: [...state.seen, event.seq] };
  switch (event.type) {
    case "run.started":
      return { ...next, status: "running", runId: event.runId, kind: event.kind, startedAt: event.at, inputs: event.inputs };
    case "stage.started":
      return { ...next, stage: event.stage };
    case "stage.done":
      return { ...next, stats: { stages: { ...state.stats.stages, [event.stage]: event.stats } } };
    case "trace.step":
      return { ...next, trace: [...state.trace, event.step] };
    case "evidence.added":
      return state.ledger.some((e) => e.id === event.evidence.id) ? next : { ...next, ledger: [...state.ledger, event.evidence] };
    case "audience.proof":
      return { ...next, audience: { ...state.audience, proof: event.proof } };
    case "audience.gap":
      return { ...next, audience: { ...state.audience, gap: event.gap } };
    case "audience.segments":
      return { ...next, audience: { ...state.audience, segments: event.segments } };
    case "run.partial":
      return { ...next, status: "partial", partial: { stage: event.stage, reason: event.reason } };
    case "run.done":
      return { ...next, status: state.status === "partial" ? "partial" : TERMINAL.includes(state.status) ? state.status : "done", stage: null };
    case "run.failed":
      return { ...next, status: "failed", error: event.message, stage: null, partial: { stage: event.stage ?? state.stage ?? "prove", reason: event.message } };
  }
}

/** Folds events in `seq` order (they may arrive out of order), ignoring duplicates. */
export function reduce(events: readonly RunEvent[], from: ReportState = initialState): ReportState {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(apply, from);
}

/**
 * The finished report. Throws if the run never started or is still running. A failed run becomes a
 * partial report (what was measured, plus why it stopped), never a normal-looking one.
 */
export function toReport(state: ReportState): Report {
  if (!state.runId || !state.kind || !state.inputs || !state.startedAt) throw new Error("The run never started.");
  if (state.status === "running" || state.status === "idle") throw new Error("The run is still in progress.");
  return reportSchema.parse({
    version: REPORT_VERSION,
    meta: {
      id: state.runId,
      kind: state.kind,
      createdAt: state.startedAt,
      provenance: state.status === "partial" || state.status === "failed" ? "partial" : state.kind === "example" ? "recorded" : "live",
    },
    inputs: state.inputs,
    ledger: state.ledger,
    audience: state.audience,
    worlds: [],
    trace: state.trace,
    stats: state.stats,
    partial: state.partial,
  });
}

/** Stamps events with `seq` and `at` as stages emit them. The clock is injectable for reproducible recordings. */
export function createEmitter(now: () => Date = () => new Date()) {
  const events: RunEvent[] = [];
  return {
    events,
    emit(input: RunEventInput): RunEvent {
      const event = runEventSchema.parse({ ...input, seq: events.length, at: now().toISOString() });
      events.push(event);
      return event;
    },
  };
}
export type Emitter = ReturnType<typeof createEmitter>;
