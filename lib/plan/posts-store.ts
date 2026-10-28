// Where the marketing lane reads a plan and writes its events: the pipeline lane's plan store
// (lib/plan/store.ts) behind a small interface, so the routes and tests can pass their own. An example
// ("ex-<slug>") reads its recording plus anything added to it in the store; a live plan reads the store.
import { createPlanEmitter, reducePlan, type PlanEventInput, type PlanState } from "./events";
import { planExampleSlug } from "./example-list";
import type { PlanReport } from "./schema";
import { appendPlanEvents, livePlanIdSchema, loadPlanEvents } from "./store";
import type { Store } from "../store/types";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/posts-store runs on the server only.");
}

/** What a poster or posts step needs from a plan: live or example, the same shape. */
export type MarketingReport = Pick<PlanReport, "inputs" | "plan" | "local" | "meta" | "poster" | "posts" | "cost" | "test">;

export interface PlanSource {
  /** A plan's events so far, folded; null when there is no such plan. */
  state(planId: string): Promise<PlanState | null>;
  /** Appends events to a plan (the store stamps seq; the emitter stamps at). */
  append(planId: string, events: PlanEventInput[]): Promise<void>;
}

export const isExampleId = (id: string) => planExampleSlug(id) !== null;
export const isLivePlanId = (id: string) => livePlanIdSchema.safeParse(id).success;

/** A folded plan as the marketing steps read it, or null before it started. */
export function reportOf(state: PlanState): MarketingReport | null {
  const r = state.report;
  if (!state.runId || !state.kind || !state.createdAt || !r.inputs) return null;
  return {
    inputs: r.inputs,
    plan: r.plan,
    local: r.local,
    poster: r.poster,
    posts: r.posts,
    cost: r.cost,
    test: r.test,
    meta: { id: state.runId, kind: state.kind, createdAt: state.createdAt, provenance: state.kind === "example" ? "recorded" : "live" },
  };
}

/** The plan store as a source. Without a store, examples still read their recordings and nothing is written. */
export function storePlanSource(store: Store | null, options: { now?: () => Date } = {}): PlanSource {
  return {
    async state(planId) {
      if (!isExampleId(planId) && !isLivePlanId(planId)) return null;
      const events = await loadPlanEvents(store, planId);
      if (events.length === 0) return null;
      const state = reducePlan(events);
      return state.runId ? state : null;
    },
    async append(planId, inputs) {
      if (inputs.length === 0) return;
      if (!store) throw new Error("No store to write the plan's events to.");
      const emit = createPlanEmitter(options.now);
      await appendPlanEvents(store, planId, inputs.map(emit));
    },
  };
}
