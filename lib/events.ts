// Run events: one zod schema and one reducer for live SSE, finished-run replays and example
// replays. Stages emit events; the UI and the stored report are both built by `reduce`, so a stored
// run replays to exactly the report it produced (the golden test).
import { z } from "zod";
import { evidenceSchema, type Evidence } from "./evidence";
import {
  citedEvidence,
  costSchema,
  gapSchema,
  inputsSchema,
  proofSchema,
  REPORT_VERSION,
  reportSchema,
  segmentsSchema,
  stageSchema,
  stageStatsSchema,
  traceStepSchema,
  type Cost,
  type Report,
  type Stage,
} from "./report/schema";
import {
  CONTROL_ID,
  comparisonSchema,
  conceptSetSchema,
  controlFitSchema,
  controlMappingSchema,
  controlSchema,
  cultureFieldSchema,
  kitSchema,
  revisionSchema,
  settingCitySchema,
  worldCheckSchema,
  worldFramesSchema,
  type Comparison,
  type Control,
  type World,
} from "./report/world";
import { briefSlotsSchema } from "./prompts/brief";
import { productionPackSchema } from "./prompts/pack";

const base = {
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  /** 1 (or absent) for a fresh run, 2 and up after a resume: each attempt streams again from seq 0. */
  attempt: z.number().int().min(1).optional(),
};
const segmentIdSchema = z.string().regex(/^[a-z0-9-]+$/);
const world = { ...base, segmentId: segmentIdSchema };

export const runEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("run.started"), runId: z.string().min(1), kind: z.enum(["live", "example"]), inputs: inputsSchema }),
  // Run-scoped stages carry no segmentId; world-scoped ones carry the world's id, or CONTROL_ID for the Control.
  z.strictObject({ ...base, type: z.literal("stage.started"), stage: stageSchema, segmentId: segmentIdSchema.optional() }),
  z.strictObject({ ...base, type: z.literal("stage.done"), stage: stageSchema, stats: stageStatsSchema, segmentId: segmentIdSchema.optional() }),
  z.strictObject({ ...base, type: z.literal("trace.step"), step: traceStepSchema }),
  z.strictObject({ ...base, type: z.literal("evidence.added"), evidence: evidenceSchema }),
  z.strictObject({ ...base, type: z.literal("audience.proof"), proof: proofSchema }),
  z.strictObject({ ...base, type: z.literal("audience.gap"), gap: gapSchema }),
  z.strictObject({ ...base, type: z.literal("audience.segments"), segments: segmentsSchema }),
  z.strictObject({ ...world, type: z.literal("world.started"), label: z.string().min(1) }),
  z.strictObject({ ...world, type: z.literal("world.check"), check: worldCheckSchema }),
  z.strictObject({
    ...world,
    type: z.literal("world.culture"),
    settingCity: settingCitySchema.nullable(),
    culture: z.array(cultureFieldSchema),
    brief: briefSlotsSchema,
    richSlots: z.array(z.string().min(1)),
  }),
  z.strictObject({ ...world, type: z.literal("world.concepts"), concepts: conceptSetSchema }),
  z.strictObject({ ...world, type: z.literal("world.pack"), pack: productionPackSchema, kit: kitSchema }),
  /** One world stopped early; the other worlds go on. */
  z.strictObject({ ...world, type: z.literal("world.partial"), stage: stageSchema, reason: z.string().min(1) }),
  z.strictObject({
    ...base,
    type: z.literal("control.brief"),
    run: controlSchema.shape.run,
    brief: briefSlotsSchema,
    assumed: controlSchema.shape.assumed,
    mappings: z.array(controlMappingSchema),
  }),
  z.strictObject({ ...base, type: z.literal("control.fit"), fit: controlFitSchema }),
  z.strictObject({ ...base, type: z.literal("control.concepts"), concepts: conceptSetSchema }),
  z.strictObject({ ...base, type: z.literal("control.pack"), pack: productionPackSchema, kit: kitSchema }),
  z.strictObject({ ...base, type: z.literal("control.partial"), stage: stageSchema, reason: z.string().min(1) }),
  z.strictObject({ ...base, type: z.literal("comparison.ready"), comparison: comparisonSchema }),
  z.strictObject({ ...base, type: z.literal("run.cost"), cost: costSchema }),
  // After the run: storyboard frames (their own invocation) and "Not this vibe" revisions.
  z.strictObject({ ...world, type: z.literal("world.frames"), frames: worldFramesSchema }),
  z.strictObject({ ...world, type: z.literal("world.revised"), revision: revisionSchema }),
  z.strictObject({ ...base, type: z.literal("run.partial"), stage: stageSchema, reason: z.string().min(1) }),
  z.strictObject({ ...base, type: z.literal("run.done") }),
  z.strictObject({ ...base, type: z.literal("run.failed"), stage: stageSchema.nullable(), message: z.string().min(1) }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;
/** An event before the emitter stamps `seq` and `at`. */
export type RunEventInput = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "seq" | "at" | "attempt"> : never) : never;

export type RunStatus = "idle" | "running" | "done" | "partial" | "failed";

/** The Control as it streams in: its brief first, then a fit per world, then its concepts and pack. */
export type ControlState = Omit<Control, "run" | "brief" | "assumed"> & {
  run: number | null;
  brief: Control["brief"] | null;
  assumed: Control["assumed"] | null;
};

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
  /** In the order each world started. */
  worlds: World[];
  control: ControlState | null;
  comparison: Comparison | null;
  trace: Report["trace"];
  stats: Report["stats"];
  partial: Report["partial"];
  cost: Cost | null;
  /** The attempt this state was built from: a resumed run streams again from seq 0 under a higher attempt. */
  attempt: number;
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
  worlds: [],
  control: null,
  comparison: null,
  trace: [],
  stats: { stages: {} },
  partial: null,
  cost: null,
  attempt: 1,
  error: null,
};

const TERMINAL: readonly RunStatus[] = ["done", "partial", "failed"];

const emptyWorld = (segmentId: string, label: string): World => ({
  segmentId,
  label,
  settingCity: null,
  check: null,
  culture: null,
  brief: null,
  richSlots: [],
  concepts: null,
  pack: null,
  kit: null,
  stats: {},
  partial: null,
  frames: null,
  revisions: [],
});

/** Updates one world, creating it if its world.started has not arrived yet (it keeps the id as a label until then). */
function withWorld(worlds: readonly World[], segmentId: string, change: (world: World) => World): World[] {
  const index = worlds.findIndex((w) => w.segmentId === segmentId);
  if (index === -1) return [...worlds, change(emptyWorld(segmentId, segmentId))];
  return worlds.map((w, i) => (i === index ? change(w) : w));
}

const emptyControl: ControlState = {
  run: null,
  brief: null,
  assumed: null,
  mappings: [],
  fits: [],
  concepts: null,
  pack: null,
  kit: null,
  stats: {},
  partial: null,
};

type Scope = { stats: World["stats"]; partial: World["partial"] };

const hasWorld = (state: ReportState, segmentId: string) => segmentId !== CONTROL_ID && state.worlds.some((w) => w.segmentId === segmentId);

/** A world-scoped stage event lands on its world, or on the Control. */
function scoped(state: ReportState, segmentId: string, change: (scope: Scope) => Scope): Pick<ReportState, "worlds" | "control"> {
  if (segmentId === CONTROL_ID) {
    const control = state.control ?? emptyControl;
    return { worlds: state.worlds, control: { ...control, ...change(control) } };
  }
  return { worlds: withWorld(state.worlds, segmentId, (w) => ({ ...w, ...change(w) })), control: state.control };
}

/**
 * What may still arrive after a run ended: storyboard frames and revisions, with their own receipts
 * and trace steps. Nothing else changes a finished run.
 */
const AFTER_RUN: ReadonlySet<RunEvent["type"]> = new Set(["world.frames", "world.revised", "run.cost", "evidence.added", "trace.step"]);

/**
 * Applies one event. A repeat (same seq, e.g. an SSE reconnect) changes nothing; a late event with a
 * lower, unseen seq still applies. Once a run ended (done or failed), only frames, revisions and
 * their receipts and trace steps still apply, and a second run.started never replaces the first.
 */
export function apply(state: ReportState, event: RunEvent): ReportState {
  // A resumed run replays from seq 0 under a higher attempt: its first event starts a fresh state,
  // and anything from an older attempt that arrives late is ignored.
  const attempt = event.attempt ?? 1;
  if (attempt < state.attempt) return state;
  if (attempt > state.attempt) return apply({ ...initialState, attempt }, event);
  if (state.seen.includes(event.seq)) return state;
  const ended = state.status === "done" || state.status === "failed" || (state.status === "partial" && state.stage === null);
  if (ended && event.seq > state.lastSeq && !AFTER_RUN.has(event.type)) return state;
  if (event.type === "run.started" && state.runId !== null) return state;
  const next: ReportState = { ...state, lastSeq: Math.max(state.lastSeq, event.seq), seen: [...state.seen, event.seq] };
  switch (event.type) {
    case "run.started":
      return { ...next, status: "running", runId: event.runId, kind: event.kind, startedAt: event.at, inputs: event.inputs };
    case "stage.started":
      // The run's current stage moves with run-scoped stages; worlds run side by side and report their own.
      return event.segmentId ? next : { ...next, stage: event.stage };
    case "stage.done":
      if (event.segmentId) return { ...next, ...scoped(state, event.segmentId, (s) => ({ ...s, stats: { ...s.stats, [event.stage]: event.stats } })) };
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
    case "world.started":
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, label: event.label })) };
    case "world.check":
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, check: event.check })) };
    case "world.culture":
      return {
        ...next,
        worlds: withWorld(state.worlds, event.segmentId, (w) => ({
          ...w,
          settingCity: event.settingCity,
          culture: event.culture,
          brief: event.brief,
          richSlots: event.richSlots,
        })),
      };
    case "world.concepts":
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, concepts: event.concepts })) };
    case "world.pack":
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, pack: event.pack, kit: event.kit })) };
    case "world.partial":
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, partial: { stage: event.stage, reason: event.reason } })) };
    case "control.brief": {
      const control = state.control ?? emptyControl;
      return { ...next, control: { ...control, run: event.run, brief: event.brief, assumed: event.assumed, mappings: event.mappings } };
    }
    case "control.fit": {
      const control = state.control ?? emptyControl;
      // A repeat replaces the old fit in place.
      const index = control.fits.findIndex((fit) => fit.segmentId === event.fit.segmentId);
      const fits = index === -1 ? [...control.fits, event.fit] : control.fits.map((fit, i) => (i === index ? event.fit : fit));
      return { ...next, control: { ...control, fits } };
    }
    case "control.concepts":
      return { ...next, control: { ...(state.control ?? emptyControl), concepts: event.concepts } };
    case "control.pack":
      return { ...next, control: { ...(state.control ?? emptyControl), pack: event.pack, kit: event.kit } };
    case "control.partial":
      return { ...next, control: { ...(state.control ?? emptyControl), partial: { stage: event.stage, reason: event.reason } } };
    case "comparison.ready":
      return { ...next, comparison: event.comparison };
    case "run.cost":
      return { ...next, cost: event.cost };
    case "world.frames": {
      // Frames and revisions land only on a world the run built, so a stray one can never add a world
      // or break the report: frames must render that world's pack or one of its revisions.
      const { revisionId } = event.frames;
      const world = state.worlds.find((w) => w.segmentId === event.segmentId);
      if (!hasWorld(state, event.segmentId) || (revisionId !== null && !world?.revisions.some((r) => r.id === revisionId))) return next;
      return { ...next, worlds: withWorld(state.worlds, event.segmentId, (w) => ({ ...w, frames: event.frames })) };
    }
    case "world.revised": {
      // A revision's receipts arrive first, in the same write; one citing a receipt the ledger lacks is dropped.
      const { revision } = event;
      const ledger = new Set(state.ledger.map((e) => e.id));
      const wrongWorld = revision.brief.segment.id !== event.segmentId || (revision.pack !== null && revision.pack.segmentId !== event.segmentId);
      if (!hasWorld(state, event.segmentId) || wrongWorld || !citedEvidence(revision).every((id) => ledger.has(id))) return next;
      // A repeat of the same revision replaces it in place.
      return {
        ...next,
        worlds: withWorld(state.worlds, event.segmentId, (w) => {
          const index = w.revisions.findIndex((r) => r.id === event.revision.id);
          return { ...w, revisions: index === -1 ? [...w.revisions, event.revision] : w.revisions.map((r, i) => (i === index ? event.revision : r)) };
        }),
      };
    }
    case "run.partial":
      return { ...next, status: "partial", partial: { stage: event.stage, reason: event.reason } };
    case "run.done":
      return { ...next, status: state.status === "partial" ? "partial" : TERMINAL.includes(state.status) ? state.status : "done", stage: null };
    case "run.failed":
      return { ...next, status: "failed", error: event.message, stage: null, partial: { stage: event.stage ?? state.stage ?? "prove", reason: event.message } };
  }
}

/** Folds events in attempt, then `seq` order (they may arrive out of order), ignoring duplicates. */
export function reduce(events: readonly RunEvent[], from: ReportState = initialState): ReportState {
  return [...events].sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1) || a.seq - b.seq).reduce(apply, from);
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
    worlds: inSegmentOrder(state),
    control: finishedControl(state.control, inSegmentOrder(state)),
    comparison: state.comparison,
    trace: state.trace,
    stats: state.stats,
    partial: state.partial,
    cost: state.cost,
  });
}

/** Worlds in the order Segments measured them, then any others as they arrived. Live views use it too, so they match the replay. */
export function inSegmentOrder(state: Pick<ReportState, "worlds" | "audience">): World[] {
  const order = state.audience.segments?.items.map((s) => s.id) ?? [];
  const at = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return state.worlds
    .map((world, i) => ({ world, i }))
    .sort((a, b) => at(a.world.segmentId) - at(b.world.segmentId) || a.i - b.i)
    .map(({ world }) => world);
}

/** The Control as the report shows it: only once its brief has arrived, with its fits in world order. */
function finishedControl(control: ControlState | null, worlds: readonly World[]): Control | null {
  if (!control || control.run === null || !control.brief || !control.assumed) return null;
  const at = (id: string) => worlds.findIndex((w) => w.segmentId === id);
  const fits = control.fits
    .map((fit, i) => ({ fit, i }))
    .sort((a, b) => at(a.fit.segmentId) - at(b.fit.segmentId) || a.i - b.i)
    .map(({ fit }) => fit);
  return { ...control, run: control.run, brief: control.brief, assumed: control.assumed, fits };
}

/**
 * Stamps events with `seq` and `at` as stages emit them, numbering seqs itself. For recordings and
 * tests: live runs take their seqs from the store (lib/store/runs.ts appendRunEvents), batched. The
 * clock is injectable for reproducible recordings.
 */
export function createEmitter(now: () => Date = () => new Date(), options: { attempt?: number } = {}) {
  const events: RunEvent[] = [];
  return {
    events,
    emit(input: RunEventInput): RunEvent {
      const event = runEventSchema.parse({ ...input, seq: events.length, at: now().toISOString(), ...(options.attempt ? { attempt: options.attempt } : {}) });
      events.push(event);
      return event;
    },
  };
}
export type Emitter = ReturnType<typeof createEmitter>;
