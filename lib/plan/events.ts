// Plan events: one zod schema and one reducer for live SSE, finished-run replays and example replays,
// the same design as Stoop's run events (lib/events.ts). Stages emit events; the UI and the stored
// plan report are both built by `reducePlan`, so a stored run replays to exactly the report it produced.
import { z } from "zod";
import { evidenceSchema } from "../evidence";
import { costSchema, stageStatsSchema } from "../report/stages";
import {
  PLAN_VERSION,
  baselineSchema,
  blockSchema,
  cityTasteSchema,
  comparisonSchema,
  conceptSchema,
  inputsSchema,
  planReportSchema,
  planSchema,
  planStageSchema,
  posterSchema,
  postsSchema,
  resultsSchema,
  traceStepSchema,
  type PlanReport,
} from "./schema";

const base = {
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  /** 1 (or absent) for a fresh run, 2 and up after a resume. */
  attempt: z.number().int().min(1).optional(),
};

export const planEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("plan.started"), runId: z.string().min(1), kind: z.enum(["live", "example"]), inputs: inputsSchema }),
  z.strictObject({ ...base, type: z.literal("stage.started"), stage: planStageSchema }),
  z.strictObject({ ...base, type: z.literal("stage.done"), stage: planStageSchema, stats: stageStatsSchema }),
  z.strictObject({ ...base, type: z.literal("trace.step"), step: traceStepSchema }),
  z.strictObject({ ...base, type: z.literal("evidence.added"), evidence: evidenceSchema }),
  z.strictObject({ ...base, type: z.literal("local.city"), city: cityTasteSchema }),
  z.strictObject({ ...base, type: z.literal("local.block"), block: blockSchema }),
  z.strictObject({ ...base, type: z.literal("local.gap"), text: z.string().min(1) }),
  /** The concepts as soon as they are scored, before the full plan (the live view shows them). */
  z.strictObject({ ...base, type: z.literal("plan.concepts"), concepts: z.array(conceptSchema).min(1).max(3) }),
  z.strictObject({ ...base, type: z.literal("plan.ready"), plan: planSchema }),
  z.strictObject({ ...base, type: z.literal("baseline.ready"), baseline: baselineSchema }),
  z.strictObject({ ...base, type: z.literal("comparison.ready"), comparison: comparisonSchema }),
  // Marketing runs after the plan, as its own invocation for the poster.
  z.strictObject({ ...base, type: z.literal("poster.updated"), poster: posterSchema }),
  z.strictObject({ ...base, type: z.literal("posts.ready"), posts: postsSchema }),
  z.strictObject({ ...base, type: z.literal("results.logged"), results: resultsSchema }),
  z.strictObject({ ...base, type: z.literal("run.cost"), cost: costSchema }),
  z.strictObject({ ...base, type: z.literal("run.partial"), stage: planStageSchema, reason: z.string().min(1) }),
  z.strictObject({ ...base, type: z.literal("run.done") }),
  z.strictObject({ ...base, type: z.literal("run.failed"), stage: planStageSchema.nullable(), message: z.string().min(1) }),
]);
export type PlanEvent = z.infer<typeof planEventSchema>;
/** An event before the emitter stamps `seq` and `at`. */
export type PlanEventInput = PlanEvent extends infer E ? (E extends PlanEvent ? Omit<E, "seq" | "at" | "attempt"> : never) : never;

export type PlanRunStatus = "idle" | "running" | "done" | "partial" | "failed";

/** The plan report so far, plus where the run is. A finished run's state converts to a PlanReport. */
export interface PlanState {
  status: PlanRunStatus;
  runId: string | null;
  kind: "live" | "example" | null;
  createdAt: string | null;
  /** The stage running now, for the progress rail. */
  current: z.infer<typeof planStageSchema> | null;
  failure: string | null;
  report: Omit<PlanReport, "version" | "meta" | "inputs"> & { inputs: PlanReport["inputs"] | null };
}

export const initialPlanState: PlanState = {
  status: "idle",
  runId: null,
  kind: null,
  createdAt: null,
  current: null,
  failure: null,
  report: {
    inputs: null,
    ledger: [],
    local: { city: null, block: null, gaps: [] },
    plan: null,
    baseline: null,
    comparison: null,
    poster: { status: "none", prompt: "", promptHash: "", alt: "" },
    posts: null,
    results: [],
    trace: [],
    stats: { stages: {} },
    partial: null,
    cost: null,
  },
};

export function applyPlan(state: PlanState, event: PlanEvent): PlanState {
  const r = state.report;
  const with_ = (report: Partial<PlanState["report"]>, rest: Partial<PlanState> = {}): PlanState => ({ ...state, ...rest, report: { ...r, ...report } });
  switch (event.type) {
    case "plan.started":
      return { ...state, status: "running", runId: event.runId, kind: event.kind, createdAt: state.createdAt ?? event.at, report: { ...r, inputs: event.inputs } };
    case "stage.started":
      return { ...state, current: event.stage };
    case "stage.done":
      return with_({ stats: { stages: { ...r.stats.stages, [event.stage]: event.stats } } }, { current: state.current === event.stage ? null : state.current });
    case "trace.step":
      return with_({ trace: [...r.trace, event.step] });
    case "evidence.added":
      return r.ledger.some((e) => e.id === event.evidence.id) ? state : with_({ ledger: [...r.ledger, event.evidence] });
    case "local.city":
      return with_({ local: { ...r.local, city: event.city } });
    case "local.block":
      return with_({ local: { ...r.local, block: event.block } });
    case "local.gap":
      return r.local.gaps.includes(event.text) ? state : with_({ local: { ...r.local, gaps: [...r.local.gaps, event.text] } });
    case "plan.concepts":
      // A concepts-only preview until the full plan lands; the plan keeps its own copy.
      return r.plan ? state : with_({ plan: { conceptId: event.concepts.find((c) => c.kept)?.id ?? event.concepts[0]!.id, concepts: event.concepts, runOfShow: [], shopping: [], checklist: [], estimatedCostUsd: 0 } });
    case "plan.ready":
      return with_({ plan: event.plan });
    case "baseline.ready":
      return with_({ baseline: event.baseline });
    case "comparison.ready":
      return with_({ comparison: event.comparison });
    case "poster.updated":
      return with_({ poster: event.poster });
    case "posts.ready":
      return with_({ posts: event.posts });
    case "results.logged":
      return with_({ results: [...r.results, event.results] });
    case "run.cost":
      return with_({ cost: event.cost });
    case "run.partial":
      return with_({ partial: { stage: event.stage, reason: event.reason } }, { status: "partial" });
    case "run.done":
      return { ...state, status: r.partial ? "partial" : "done", current: null };
    case "run.failed":
      return { ...state, status: "failed", current: null, failure: event.message };
  }
}

/** Folds events in attempt, then `seq` order (they may arrive out of order), ignoring duplicates. */
export function reducePlan(events: readonly PlanEvent[], from: PlanState = initialPlanState): PlanState {
  const seen = new Set<string>();
  const ordered = [...events].sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1) || a.seq - b.seq);
  return ordered.reduce((state, event) => {
    const key = `${event.attempt ?? 1}:${event.seq}`;
    if (seen.has(key)) return state;
    seen.add(key);
    return applyPlan(state, event);
  }, from);
}

/** A finished (or partial) run as a validated PlanReport. Throws if the run never started. */
export function toPlanReport(state: PlanState, provenance: PlanReport["meta"]["provenance"] = state.status === "partial" ? "partial" : state.kind === "example" ? "recorded" : "live"): PlanReport {
  if (!state.runId || !state.kind || !state.createdAt || !state.report.inputs) throw new Error("the plan run never started");
  return planReportSchema.parse({
    version: PLAN_VERSION,
    meta: { id: state.runId, kind: state.kind, createdAt: state.createdAt, provenance },
    ...state.report,
    inputs: state.report.inputs,
  });
}

/** Stamps `seq` and `at` on events as a stage emits them. */
export function createPlanEmitter(now: () => Date = () => new Date(), options: { attempt?: number } = {}) {
  let seq = 0;
  return (input: PlanEventInput): PlanEvent => {
    const event = { ...input, seq: seq++, at: now().toISOString(), ...(options.attempt && options.attempt > 1 ? { attempt: options.attempt } : {}) };
    return planEventSchema.parse(event);
  };
}
export type PlanEmitter = ReturnType<typeof createPlanEmitter>;
