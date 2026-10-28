// Where the marketing lane reads a plan and writes its events. The pipeline lane owns the plan store
// (lib/plan/store.ts: appendPlanEvents, loadPlanEvents, loadPlanReport) and the example loaders
// (lib/plan/examples.ts); this file is the thin interface the marketing code is written against, with
// a stand-in implementation until those land, so the routes and tests run on their own. Once they do,
// `planSource` wires to them and the stand-in goes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPlanEmitter, planEventSchema, reducePlan, type PlanEvent, type PlanEventInput, type PlanState } from "./events";
import { planReportSchema, type PlanReport } from "./schema";
import type { Store } from "../store/types";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/posts-store runs on the server only.");
}

/** What a poster or posts step needs from a plan: live or example, the same shape. */
export type MarketingReport = Pick<PlanReport, "inputs" | "plan" | "local" | "meta" | "poster" | "posts" | "cost">;

export interface PlanSource {
  /** A live run's events so far, folded; null when there is no such run. */
  state(runId: string): Promise<PlanState | null>;
  /** Appends events to a live run (the source stamps seq and at). */
  append(runId: string, events: PlanEventInput[]): Promise<void>;
  /** A recorded example's report by slug, or null. */
  example(slug: string): Promise<PlanReport | null>;
}

export const EXAMPLE_PREFIX = "ex-";
export const exampleSlugOf = (id: string): string | null => (id.startsWith(EXAMPLE_PREFIX) && /^[a-z0-9-]+$/.test(id.slice(3)) ? id.slice(3) : null);

/** A folded live run as the marketing steps read it, or null before it started. */
export function reportOf(state: PlanState): MarketingReport | null {
  const r = state.report;
  if (!state.runId || !state.kind || !state.createdAt || !r.inputs) return null;
  return { inputs: r.inputs, plan: r.plan, local: r.local, poster: r.poster, posts: r.posts, cost: r.cost, meta: { id: state.runId, kind: state.kind, createdAt: state.createdAt, provenance: "live" } };
}

// --- The stand-in, until lib/plan/store.ts lands --------------------------------------------------

const RUN_TTL = 7 * 24 * 60 * 60;
const eventsKey = (runId: string) => `plan:${runId}:events`;
const seqKey = (runId: string) => `plan:${runId}:seq`;

export function storePlanSource(store: Store, options: { dataDir?: string; now?: () => Date } = {}): PlanSource {
  const dataDir = options.dataDir ?? join(process.cwd(), "data/plans");
  return {
    async state(runId) {
      const raw = await store.range<unknown>(eventsKey(runId), 0, -1);
      if (raw.length === 0) return null;
      const events = raw.flatMap((e) => {
        const parsed = planEventSchema.safeParse(e);
        return parsed.success ? [parsed.data] : [];
      });
      return reducePlan(events);
    },
    async append(runId, inputs) {
      if (inputs.length === 0) return;
      const last = await store.incr(seqKey(runId), { by: inputs.length, ttlSeconds: RUN_TTL });
      const emit = createPlanEmitter(options.now);
      const events: PlanEvent[] = inputs.map((input, i) => ({ ...emit(input), seq: last - inputs.length + i }));
      await store.append(eventsKey(runId), events, { ttlSeconds: RUN_TTL });
    },
    async example(slug) {
      try {
        return planReportSchema.parse(JSON.parse(readFileSync(join(dataDir, slug, "plan.report.json"), "utf8")));
      } catch {
        return null;
      }
    },
  };
}
