// The plan routes' handlers, with their vendors passed in, so each route is tested against a
// MemoryStore. A plan id is a live id ("plan_" plus 24 hex) or an example's "ex-<slug>"; examples
// load from data/plans with zero API calls and work with no store at all.
import { z } from "zod";
import { stripEmDashes } from "../guardrails";
import { allowAll, type BotCheck } from "../bot-check";
import { browserOnly } from "../routes/guard";
import { ApiFailure, hourOf } from "../runtime/errors";
import { contextFor, errorResponse, json } from "../runtime/respond";
import type { Store } from "../store/types";
import { keys } from "../store/keys";
import { planExampleSlug } from "./example-list";
import { resultsSchema, type PlanReport } from "./schema";
import { exampleReply, planStartRequestSchema, startPlan, type PlanStartDeps } from "./runtime";
import { appendPlanEvents, getPlanMeta, livePlanIdSchema, loadPlanEvents, loadPlanReport, readStoredPlanEvents } from "./store";
import { lastSeq, marketingBusy, SSE_HEADERS, streamExamplePlan, streamLivePlan } from "./stream";
import { createPlanEmitter } from "./events";

type Env = Readonly<Record<string, string | undefined>>;

export interface PlanRouteDeps {
  env?: Env;
  /** The shared store, only asked for once a route needs it. It may throw where no store is set up. */
  store: () => Store;
  start: () => PlanStartDeps;
  now?: () => number;
  botCheck?: () => BotCheck;
}

/** The store, or null when none is set up: examples still load from disk without one. */
function storeOrNull(deps: PlanRouteDeps): Store | null {
  try {
    return deps.store();
  } catch {
    return null;
  }
}

const notFound = () => new ApiFailure("not_found", "That plan has expired or does not exist.", 404);

/** POST /api/plan: starts (or joins) a live plan, or answers with an example replay and why. */
export async function postPlan(request: Request, deps: PlanRouteDeps): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const no = await browserOnly(request, deps.botCheck ?? (() => allowAll));
    if (no) return no;
    const store = storeOrNull(deps);
    if (!store) {
      // No shared store: nothing live could be kept, so the answer is an example, never an error screen.
      return json(exampleReply("replay", planStartRequestSchema.parse(body).inputs));
    }
    return json(await startPlan({ ...deps.start(), env: deps.env }, body, await contextFor(request, store)));
  } catch (error) {
    return errorResponse(error);
  }
}

export type PlanResponse =
  | { status: "running"; id: string; report: PlanReport | null; eventsUrl: string }
  | { status: "done" | "partial" | "failed"; id: string; report: PlanReport | null; eventsUrl: string | null };

/** GET /api/plan/[id]: the plan's report so far, and where to follow it while it runs. */
export async function getPlan(id: string, deps: PlanRouteDeps): Promise<Response> {
  try {
    if (planExampleSlug(id)) {
      const report = await loadPlanReport(storeOrNull(deps), id);
      if (!report) throw notFound();
      return json({ status: report.partial ? "partial" : "done", id, report, eventsUrl: null } satisfies PlanResponse);
    }
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    const report = await loadPlanReport(store, runId.data);
    const eventsUrl = `/api/plan/${runId.data}/events`;
    return json({ status: meta.status, id, report, eventsUrl } satisfies PlanResponse);
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/plan/[id]/events: the plan's events as server-sent events. 204 tells a finished viewer to stop reconnecting. */
export async function getPlanEvents(request: Request, id: string, deps: PlanRouteDeps): Promise<Response> {
  try {
    const lastEventId = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("lastEventId");
    const seen = lastSeq(lastEventId);
    if (planExampleSlug(id)) {
      const events = await loadPlanEvents(storeOrNull(deps), id);
      if (seen !== null && seen >= Math.max(...events.map((e) => e.seq))) return new Response(null, { status: 204 });
      return new Response(streamExamplePlan(events, { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
    }
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    // A viewer that has everything gets 204 and stops, unless the poster and posts are still being made.
    if (seen !== null && meta.status !== "running" && !(await marketingBusy(store, runId.data))) {
      const events = await readStoredPlanEvents(store, runId.data);
      if (events.length && events.at(-1)!.seq === seen) return new Response(null, { status: 204 });
    }
    return new Response(streamLivePlan(store, runId.data, { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

/** What the manager logs after the event; loggedAt is set by the server. */
export const resultsRequestSchema = resultsSchema.omit({ loggedAt: true });
export type ResultsRequest = z.infer<typeof resultsRequestSchema>;

/** Results logged per visitor per hour. */
export const RESULTS_PER_HOUR = 20;

/** POST /api/plan/[id]/results: logs a results.logged event on a live plan. Example plans are read-only. */
export async function postPlanResults(request: Request, id: string, deps: PlanRouteDeps): Promise<Response> {
  try {
    const body = resultsRequestSchema.parse(stripEmDashes(await request.json()));
    if (planExampleSlug(id)) throw new ApiFailure("invalid", "Example plans are read-only. Start a plan for your store to log its results.", 403);
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const no = await browserOnly(request, deps.botCheck ?? (() => allowAll));
    if (no) return no;
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    const ctx = await contextFor(request, store);
    const now = deps.now ?? Date.now;
    if ((await store.incr(keys.rate("plan-results", ctx.visitor, hourOf(now())), { ttlSeconds: 60 * 60 })) > RESULTS_PER_HOUR) {
      throw new ApiFailure("rate_limited", "That is a lot of results in an hour. Try again a little later.", 429);
    }
    const results = resultsSchema.parse({ ...body, loggedAt: new Date(now()).toISOString() });
    const [event] = await appendPlanEvents(store, runId.data, [createPlanEmitter(() => new Date(now()))({ type: "results.logged", results })]);
    return json({ ok: true, results, seq: event?.seq ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
