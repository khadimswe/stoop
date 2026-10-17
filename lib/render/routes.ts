// The draft video routes, as handlers over plain Web Requests with their dependencies injected, so
// tests run them on a MemoryStore, a fake fal queue and fake storage:
//   GET  /api/render/access?reportId=&segment=  which video line this visitor sees (renderAccessResponseSchema)
//   POST /api/render/plan {target}              the RenderPlan, built on the server (renderPlanResponseSchema)
//   POST /api/render {target}                   a server-paid draft, judge pass only (renderStatusResponseSchema)
//   GET  /api/render/<jobId>                    the job's status, advancing it when no poller has lately
// Both POSTs need an exact Origin match (the site's own origin, or NEXT_PUBLIC_APP_URL): a request with
// no Origin header or another one is refused before anything is built or reserved. The judge pass rides
// in an httpOnly SameSite=Lax cookie, so this check is what keeps another site from spending it.
import { renderRequestSchema, renderTargetSchema, type RenderTarget } from "../api/requests";
import { renderAccessResponseSchema, renderPlanResponseSchema, renderStatusResponseSchema } from "../api/responses";
import { byokEnabled, dailyCaps, isLive, renderLimits, videoSwitches } from "../config";
import type { DemoMedia } from "../demo/manifest";
import type { ExampleSlug } from "../demo/examples";
import { apiError, BodyError, json, MESSAGES, readCookie, readJson } from "../http";
import type { ImageFetch } from "../intake/guarded-fetch";
import { JUDGE_COOKIE, judgeConfig, verifyPass, type JudgePass } from "../judge/pass";
import type { RateRule } from "../rate-limit";
import type { Report } from "../report/schema";
import { failSafe, guard, type GuardDeps } from "../routes/guard";
import type { PrivateStorage, Storage } from "../storage";
import type { Store } from "../store/types";
import { dayOf } from "../store/keys";
import { videoAccess } from "./access";
import type { VideoQueue } from "./fal";
import { advanceRender, counterUsage, isStale, isTerminal, loadJob, pollRender, renderCounters, renderRoom, startRender, touchRender, type CounterName, type RenderEnv } from "./jobs";
import { buildRenderPlan, canPlan, demoBaseUrl, exampleOf, RenderError, renderSource } from "./plan";
import { privatePhotoUrl } from "./photo";
import { renderJobIdSchema, toRenderStatus, type RenderPlan } from "./schema";

type Env = Readonly<Record<string, string | undefined>>;

/** Per-IP limits on the routes themselves; the render caps are the real spend guard. */
export const RENDER_RATE_RULES = {
  access: { name: "render-access", limit: 300, windowSeconds: 10 * 60 },
  plan: { name: "render-plan", limit: 30, windowSeconds: 60 * 60 },
  render: { name: "render-start", limit: 12, windowSeconds: 60 * 60 },
  status: { name: "render-status", limit: 900, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateRule>;

export const RENDER_BODY_MAX_BYTES = 1_024;
/** The after() poller stops before the route's 300 s limit; status polls carry on from there. */
export const POLL_BUDGET_MS = 270_000;
/** A status poll's own check: fal's status, the result and the download, within the route's 120 s. */
const STATUS_ADVANCE_TIMEOUT_MS = 100_000;

export interface RenderRouteDeps extends GuardDeps {
  /** Read for every switch and cap, so tests pass their own. */
  env: Env;
  /** A report by id: the shipped examples from disk, live runs from the store (null when there is none). */
  loadReport: (reportId: string, store: Store) => Promise<Report | null>;
  /** An example's approved storyboards and packshot. */
  demoMedia: (slug: ExampleSlug) => DemoMedia;
  /** Null when no private store is configured (live runs with brand photos then cannot plan). */
  privateStorage: () => PrivateStorage | null;
  /** Public storage for finished drafts; null when none is configured (server drafts stay off). */
  storage: () => Storage | null;
  /** fal with FAL_KEY; null without a key (server drafts stay off). */
  queue: () => VideoQueue | null;
  /** Runs work after the response (next/server after()). */
  schedule: (task: () => Promise<unknown>) => void;
  fetchImage?: (url: string) => Promise<ImageFetch>;
  /** Downloads finished drafts (tests pass a fake). */
  fetch?: typeof fetch;
  /** The poller's wait between checks (tests pass one that returns at once). */
  sleep?: (ms: number) => Promise<void>;
}

const ORIGIN_MESSAGE = "Requests from other sites are not accepted.";

/** The site's own origins: the request's, and NEXT_PUBLIC_APP_URL's when set. */
export function siteOrigins(request: Request, env: Env): string[] {
  const origins = [new URL(request.url).origin];
  const app = env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) {
    try {
      origins.push(new URL(app).origin);
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL adds nothing.
    }
  }
  return origins;
}

/** Null when the Origin header is exactly the site's own; a 403 otherwise, a missing header included. */
export function originRefusal(request: Request, env: Env): Response | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && siteOrigins(request, env).includes(origin)) return null;
  return apiError("invalid", ORIGIN_MESSAGE, 403);
}

function passOf(request: Request, env: Env, now: number): JudgePass | null {
  let config;
  try {
    config = judgeConfig(env);
  } catch {
    return null;
  }
  return verifyPass(config, readCookie(request, JUDGE_COOKIE), now);
}

/** Whether Stoop pays for drafts here at all: every switch, a key, storage and caps above zero. */
function serverDraftsOn(deps: RenderRouteDeps): boolean {
  const { env } = deps;
  return videoSwitches(env).liveVideo && isLive(env) && dailyCaps(env).renders > 0 && renderLimits(env).total > 0 && deps.queue() !== null && deps.storage() !== null;
}

function renderEnv(deps: RenderRouteDeps, store: Store): RenderEnv {
  const limits = renderLimits(deps.env);
  return {
    store,
    storage: deps.storage() as Storage,
    queue: deps.queue() as VideoQueue,
    caps: { daily: dailyCaps(deps.env).renders, total: limits.total, perPass: limits.perPass, perIpDaily: limits.perIpDaily },
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
}

async function sourceFor(deps: RenderRouteDeps, store: Store, target: RenderTarget) {
  const report = await deps.loadReport(target.reportId, store);
  if (!report) throw new RenderError("not_found", "No report with that id (live runs are kept for 30 days).", 404);
  const slug = exampleOf(target.reportId);
  return renderSource(report, target, slug ? deps.demoMedia(slug) : null);
}

async function planFor(deps: RenderRouteDeps, store: Store, target: RenderTarget): Promise<RenderPlan> {
  const source = await sourceFor(deps, store, target);
  const now = deps.now?.() ?? Date.now();
  return buildRenderPlan(source, {
    now,
    draftSeconds: renderLimits(deps.env).draftSeconds,
    demoBase: demoBaseUrl(deps.env),
    photoUrl: async (sourceUrl) => {
      const storage = deps.privateStorage();
      if (!storage) throw new RenderError("off", "Drafts from a brand's own photos are not set up on this server.", 503);
      return privatePhotoUrl({ storage, now, ...(deps.fetchImage ? { fetchImage: deps.fetchImage } : {}) }, sourceUrl);
    },
  });
}

/** Runs a handler, answering a RenderError with its own code and anything else as the API's "failed". */
function answering(name: string, run: () => Promise<Response>): Promise<Response> {
  return failSafe(name, async () => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof RenderError) return apiError(error.code, error.message, error.status);
      throw error;
    }
  });
}

async function targetFromBody(request: Request): Promise<RenderTarget | Response> {
  let body: unknown;
  try {
    body = await readJson(request, RENDER_BODY_MAX_BYTES);
  } catch (error) {
    if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
    throw error;
  }
  const parsed = renderRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("invalid", "Send the target: a reportId and a segment.", 400);
  return parsed.data.target;
}

// --- GET /api/render/access --------------------------------------------------------------------------

export function createRenderAccessGet(deps: RenderRouteDeps) {
  return (request: Request) =>
    answering("GET /api/render/access", async () => {
      const params = new URL(request.url).searchParams;
      const target = renderTargetSchema.safeParse({ reportId: params.get("reportId"), segment: params.get("segment") });
      if (!target.success) return apiError("invalid", "Name a report with ?reportId= and a world with &segment=.", 400);
      const guarded = await guard(request, deps, RENDER_RATE_RULES.access);
      if (!guarded.ok) return guarded.response;
      const { store, visitor } = guarded;
      const now = deps.now?.() ?? Date.now();

      let renderable = false;
      try {
        renderable = canPlan(await sourceFor(deps, store, target.data), demoBaseUrl(deps.env));
      } catch (error) {
        if (!(error instanceof RenderError)) throw error;
        if (error.status === 404) return apiError(error.code, error.message, error.status);
      }
      const pass = passOf(request, deps.env, now);
      const server = serverDraftsOn(deps);
      let room: number | null = null;
      if (pass && server) {
        const env = renderEnv(deps, store);
        const counters = renderCounters({ passId: pass.passId, visitor, day: dayOf(now) }, env.caps);
        room = renderRoom(counters, await counterUsage(store, counters));
      }
      const answer = videoAccess({ renderable, byok: byokEnabled(deps.env), pass: pass !== null, server, room });
      return json(renderAccessResponseSchema.parse(answer));
    });
}

// --- POST /api/render/plan ---------------------------------------------------------------------------

export function createRenderPlanPost(deps: RenderRouteDeps) {
  return (request: Request) =>
    answering("POST /api/render/plan", async () => {
      const refused = originRefusal(request, deps.env);
      if (refused) return refused;
      const guarded = await guard(request, deps, RENDER_RATE_RULES.plan);
      if (!guarded.ok) return guarded.response;
      const target = await targetFromBody(request);
      if (target instanceof Response) return target;
      const pass = passOf(request, deps.env, deps.now?.() ?? Date.now());
      if (!byokEnabled(deps.env) && !pass) return apiError("off", "Rendering with your own fal key is off on this server.", 503);
      const plan = await planFor(deps, guarded.store, target);
      return json(renderPlanResponseSchema.parse({ plan }));
    });
}

// --- POST /api/render ----------------------------------------------------------------------------------

const CAPPED: Record<CounterName, string> = {
  pass: "This judge pass has used its draft renders. The storyboard and the example clip are still here.",
  ip: "This network has used today's draft renders. Back tomorrow.",
  day: "Today's draft renders are used. Back tomorrow.",
  total: "The draft render budget is used. The storyboard and the example clip are still here.",
};

export function createRenderPost(deps: RenderRouteDeps) {
  return (request: Request) =>
    answering("POST /api/render", async () => {
      const refused = originRefusal(request, deps.env);
      if (refused) return refused;
      const guarded = await guard(request, deps, RENDER_RATE_RULES.render);
      if (!guarded.ok) return guarded.response;
      const target = await targetFromBody(request);
      if (target instanceof Response) return target;
      const started = deps.now?.() ?? Date.now();
      const pass = passOf(request, deps.env, started);
      if (!pass) return apiError("off", "Drafts paid by Stoop need a judge pass. You can render with your own fal key instead.", 403);
      if (!serverDraftsOn(deps)) return apiError("off", "Draft video is off on this server right now.", 503);

      const plan = await planFor(deps, guarded.store, target);
      const env = renderEnv(deps, guarded.store);
      const outcome = await startRender(env, { plan, passId: pass.passId, visitor: guarded.visitor });
      const poll = (jobId: string) =>
        deps.schedule(() =>
          pollRender(env, jobId, { deadline: started + POLL_BUDGET_MS, ...(deps.sleep ? { sleep: deps.sleep } : {}) }).catch((error: unknown) => {
            console.error(`Draft render poller failed: ${error instanceof Error ? error.name : "error"}`);
          }),
        );
      switch (outcome.kind) {
        case "capped":
          return apiError("daily_cap", CAPPED[outcome.full], 429);
        case "failed":
          return apiError("failed", outcome.job.reason ?? MESSAGES.failed, 502);
        case "cached":
          return json(renderStatusResponseSchema.parse({ job: toRenderStatus(outcome.job) }));
        case "joined":
          if (isStale(outcome.job, started)) poll(outcome.job.id);
          return json(renderStatusResponseSchema.parse({ job: toRenderStatus(outcome.job) }), { status: 202 });
        case "started":
          poll(outcome.job.id);
          return json(renderStatusResponseSchema.parse({ job: toRenderStatus(outcome.job) }), { status: 202 });
      }
    });
}

// --- GET /api/render/<jobId> ---------------------------------------------------------------------------

export function createRenderStatusGet(deps: RenderRouteDeps) {
  return (request: Request, jobId: string) =>
    answering("GET /api/render/[jobId]", async () => {
      if (!renderJobIdSchema.safeParse(jobId).success) return apiError("invalid", "That is not a render job id.", 400);
      const guarded = await guard(request, deps, RENDER_RATE_RULES.status);
      if (!guarded.ok) return guarded.response;
      const { store } = guarded;
      const job = await loadJob(store, jobId);
      if (!job) return apiError("not_found", "No draft render with that id (jobs are kept for 7 days).", 404);
      const now = deps.now?.() ?? Date.now();
      // No poller lately (the after() poller ran out of time, or died): this poll takes over, after the
      // response, so the page never waits on fal or a download. The touch keeps the next polls from piling on.
      if (!isTerminal(job) && isStale(job, now) && deps.queue() && deps.storage()) {
        await touchRender(store, job.id, now);
        const env = renderEnv(deps, store);
        deps.schedule(() =>
          advanceRender(env, jobId, { abortSignal: AbortSignal.timeout(STATUS_ADVANCE_TIMEOUT_MS) }).catch((error: unknown) => {
            console.error(`Draft render status check failed: ${error instanceof Error ? error.name : "error"}`);
          }),
        );
      }
      return json(renderStatusResponseSchema.parse({ job: toRenderStatus(job) }));
    });
}
