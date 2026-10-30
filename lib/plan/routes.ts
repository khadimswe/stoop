// The plan routes' handlers, with their vendors passed in, so each route is tested against a
// MemoryStore. A plan id is a live id ("plan_" plus 24 hex) or an example's "ex-<slug>"; examples
// load from data/plans with zero API calls and work with no store at all.
//
// A live plan's id is also its public share id, so the id alone reads only the public view
// (lib/plan/owner.ts publicPlanReport, what /e/<id> shows). The full report, the event stream and
// logged results belong to the browser that started the plan (its signed visitor cookie).
import { z } from "zod";
import { stripEmDashes } from "../guardrails";
import { allowAll, type BotCheck } from "../bot-check";
import { BodyError, cookieVisitorOf, readJson, visitorCookie } from "../http";
import { browserOnly } from "../routes/guard";
import { ApiFailure, hourOf } from "../runtime/errors";
import { contextFor, errorResponse, json } from "../runtime/respond";
import { signingSecret } from "../sign";
import type { Store } from "../store/types";
import { keys } from "../store/keys";
import { networkVisitorId, visitorId } from "../store/visitor";
import { planExampleSlug } from "./example-list";
import { resultsSchema, type PlanReport } from "./schema";
import { inputErrorResponse } from "./input-errors";
import { exampleReply, planStartRequestSchema, startPlan, type PlanStartDeps } from "./runtime";
import { NOT_OWNER_MESSAGE, NOT_OWNER_READ_MESSAGE, isOwnerOf, publicPlanReport } from "./owner";
import { appendPlanEvents, getPlanMeta, livePlanIdSchema, loadPlanEvents, loadPlanReport, readStoredPlanEvents } from "./store";
import { lastSeq, PLAN_STREAM_MAX_MS, SSE_HEADERS, streamExamplePlan, streamLivePlan } from "./stream";
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

/** Body caps: a plan's inputs (8 promos, notes, the store) fit well under 16 KB; results under 4 KB. */
export const PLAN_BODY_MAX_BYTES = 16_384;
export const RESULTS_BODY_MAX_BYTES = 4_096;

/** The store, or null when none is set up: examples still load from disk without one. */
function storeOrNull(deps: PlanRouteDeps): Store | null {
  try {
    return deps.store();
  } catch {
    return null;
  }
}

const notFound = () => new ApiFailure("not_found", "That plan has expired or does not exist.", 404);
const envOf = (deps: PlanRouteDeps): Env => deps.env ?? process.env;

/** The request's JSON body (sent as JSON, at most `maxBytes`), or the API's 4xx for anything else. */
async function bodyOf(request: Request, maxBytes: number): Promise<unknown> {
  try {
    return await readJson(request, maxBytes);
  } catch (error) {
    if (error instanceof BodyError) throw new ApiFailure("invalid", error.message, error.status);
    throw error;
  }
}

/** POST /api/plan: starts (or joins) a live plan, or answers with an example replay and why. */
export async function postPlan(request: Request, deps: PlanRouteDeps): Promise<Response> {
  try {
    const body = await bodyOf(request, PLAN_BODY_MAX_BYTES);
    const no = await browserOnly(request, deps.botCheck ?? (() => allowAll));
    if (no) return no;
    const store = storeOrNull(deps);
    if (!store) {
      // No shared store: nothing live could be kept, so the answer is an example, never an error screen.
      return json(exampleReply("replay", planStartRequestSchema.parse(body).inputs));
    }
    // The signed visitor cookie, minted here when the browser has none: the plan it starts is owned by
    // it (lib/plan/owner.ts). Without STOOP_SIGNING_SECRET there is no cookie, and the IP stands in.
    const cookie = visitorCookie(request, signingSecret(envOf(deps)));
    const ctx = { ...(await contextFor(request, store)), cookieVisitor: cookie.id, network: await networkVisitorId(store, request.headers) };
    const response = json(await startPlan({ ...deps.start(), env: deps.env }, body, ctx));
    if (cookie.setCookie) response.headers.append("Set-Cookie", cookie.setCookie);
    return response;
  } catch (error) {
    // A field the visitor can fix answers 400 (422 for refused notes) with that field, never a 500.
    return inputErrorResponse(error) ?? errorResponse(error);
  }
}

export type PlanResponse = (
  | { status: "running"; id: string; report: PlanReport | null; eventsUrl: string | null }
  | { status: "done" | "partial" | "failed"; id: string; report: PlanReport | null; eventsUrl: string | null }
) & {
  /** True for the plan's owner, who gets the full report and its event stream; false for examples and everyone else. */
  owner: boolean;
};

/**
 * GET /api/plan/[id]: the plan's report so far, and where to follow it while it runs. An example's
 * report is public. A live plan's full report goes only to its owner; anyone else (someone who opened
 * the share link, or the manager on another device) gets the public view and no event stream.
 */
export async function getPlan(id: string, deps: PlanRouteDeps, request: Request | null = null): Promise<Response> {
  try {
    if (planExampleSlug(id)) {
      const report = await loadPlanReport(storeOrNull(deps), id);
      if (!report) throw notFound();
      return json({ status: report.partial ? "partial" : "done", id, report, eventsUrl: null, owner: false } satisfies PlanResponse);
    }
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    const owner = request !== null && (await isOwnerOf(request, meta, store, { env: envOf(deps), ...(deps.now ? { now: deps.now } : {}) }));
    const report = await loadPlanReport(store, runId.data);
    if (owner) return json({ status: meta.status, id, report, eventsUrl: `/api/plan/${runId.data}/events`, owner } satisfies PlanResponse);
    return json({ status: meta.status, id, report: report ? publicPlanReport(report) : null, eventsUrl: null, owner } satisfies PlanResponse);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Event streams one visitor may hold open at once, across plans and examples, and on one plan. */
export const PLAN_STREAMS_PER_VISITOR = 10;
export const PLAN_STREAMS_PER_PLAN = 3;
/** A stream's lease outlives the longest stream a little, so a crashed instance frees its slot. */
const STREAM_LEASE_MS = PLAN_STREAM_MAX_MS + 30_000;

const tooManyStreams = () => Response.json({ error: { code: "rate_limited", message: "This plan is already open in a few places. Close a tab and reload." } }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });

/**
 * Takes a lease per open stream (per viewer, and per viewer and plan): a release to call when the
 * stream ends, or null when the viewer already holds too many. A live plan's owner counts by their
 * signed cookie, so other people's example streams on a shared network never crowd them out; anyone
 * else counts by IP. No store (examples only): no limit.
 */
async function streamLease(store: Store | null, request: Request, planId: string, live: boolean, now: number, env: Env): Promise<(() => Promise<void>) | null | "none"> {
  if (!store) return "none";
  const visitor = (live ? cookieVisitorOf(request, signingSecret(env)) : null) ?? (await visitorId(store, request.headers));
  const member = `${planId}:${crypto.randomUUID()}`;
  const sets = [{ key: keys.planStreams(visitor), max: PLAN_STREAMS_PER_VISITOR }, ...(live ? [{ key: `${keys.planStreams(visitor)}:${planId}`, max: PLAN_STREAMS_PER_PLAN }] : [])];
  const taken: string[] = [];
  for (const set of sets) {
    if (!(await store.leaseAcquire(set.key, member, { max: set.max, ttlMs: STREAM_LEASE_MS, now }))) {
      await Promise.all(taken.map((key) => store.leaseRelease(key, member).catch(() => undefined)));
      return null;
    }
    taken.push(set.key);
  }
  return async () => {
    await Promise.all(taken.map((key) => store.leaseRelease(key, member).catch(() => undefined)));
  };
}

/**
 * GET /api/plan/[id]/events: the plan's events as server-sent events. 204 tells a finished viewer to
 * stop reconnecting. A live plan streams only to its owner (403 for anyone else, whose page then reads
 * the public view once); an example streams to anyone.
 */
export async function getPlanEvents(request: Request, id: string, deps: PlanRouteDeps): Promise<Response> {
  try {
    const lastEventId = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("lastEventId");
    const seen = lastSeq(lastEventId);
    const now = deps.now ?? Date.now;
    if (planExampleSlug(id)) {
      const store = storeOrNull(deps);
      const events = await loadPlanEvents(store, id);
      if (seen !== null && seen >= Math.max(...events.map((e) => e.seq))) return new Response(null, { status: 204 });
      const release = await streamLease(store, request, id, false, now(), envOf(deps)).catch(() => "none" as const);
      if (release === null) return tooManyStreams();
      return new Response(streamExamplePlan(events, { lastEventId, signal: request.signal, ...(release === "none" ? {} : { onClose: release }) }), { headers: SSE_HEADERS });
    }
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    if (!(await isOwnerOf(request, meta, store, { env: envOf(deps), ...(deps.now ? { now: deps.now } : {}) }))) throw new ApiFailure("invalid", NOT_OWNER_READ_MESSAGE, 403);
    if (seen !== null && meta.status !== "running") {
      const events = await readStoredPlanEvents(store, runId.data);
      if (events.length && events.at(-1)!.seq === seen) return new Response(null, { status: 204 });
    }
    const release = await streamLease(store, request, runId.data, true, now(), envOf(deps));
    if (release === null) return tooManyStreams();
    return new Response(streamLivePlan(store, runId.data, { lastEventId, signal: request.signal, ...(release === "none" ? {} : { onClose: release }) }), { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

/** What the manager logs after the event; loggedAt is set by the server. */
export const resultsRequestSchema = resultsSchema.omit({ loggedAt: true });
export type ResultsRequest = z.infer<typeof resultsRequestSchema>;

/** Results logged per visitor per hour. */
export const RESULTS_PER_HOUR = 20;

/** POST /api/plan/[id]/results: logs a results.logged event on a live plan, for its owner only. Example plans are read-only. */
export async function postPlanResults(request: Request, id: string, deps: PlanRouteDeps): Promise<Response> {
  try {
    const body = resultsRequestSchema.parse(stripEmDashes(await bodyOf(request, RESULTS_BODY_MAX_BYTES)));
    if (planExampleSlug(id)) throw new ApiFailure("invalid", "Example plans are read-only. Start a plan for your store to log its results.", 403);
    const runId = livePlanIdSchema.safeParse(id);
    if (!runId.success) throw notFound();
    const no = await browserOnly(request, deps.botCheck ?? (() => allowAll));
    if (no) return no;
    const store = deps.store();
    const meta = await getPlanMeta(store, runId.data);
    if (!meta) throw notFound();
    if (!(await isOwnerOf(request, meta, store, { env: envOf(deps), ...(deps.now ? { now: deps.now } : {}) }))) throw new ApiFailure("invalid", NOT_OWNER_MESSAGE, 403);
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
