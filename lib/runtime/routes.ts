// The runtime's route handlers, with their vendors passed in, so every route's checks are tested
// against a MemoryStore. The live switch is checked before the store is touched: replay mode works
// with no store at all, which is how every public deploy runs until Gate 5 is verified.
import { intakeRequestSchema, lastEventIdSchema, liveRunIdSchema, runStartRequestSchema, searchRequestSchema } from "../api/requests";
import type { HealthResponse, ReportResponse } from "../api/responses";
import { dailyCaps, isLive } from "../config";
import type { RunEvent } from "../events";
import type { Report } from "../report/schema";
import { keys, type DailyCap } from "../store/keys";
import { getRunMeta, liveStatus, loadReport, readRunEvents, refreshReport } from "../store/runs";
import type { Store } from "../store/types";
import { lastMonthRemaining } from "../qloo/shared";
import { allowAll, type BotCheck } from "../bot-check";
import { browserOnly } from "../routes/guard";
import type { ExampleSlug } from "../demo/examples";
import { visitorCookie } from "../http";
import { signingSecret } from "../sign";
import { ApiFailure } from "./errors";
import { runIntake, type IntakeDeps } from "./intake";
import { contextFor, errorResponse, json } from "./respond";
import { searchSeeds, type SearchDeps } from "./search";
import { exampleReply, resumeRun, startRun, type StartDeps } from "./start";
import { SSE_HEADERS, streamExample, streamLiveRun } from "./stream";

type Env = Readonly<Record<string, string | undefined>>;

export interface RouteDeps {
  env?: Env;
  /** The shared store, only asked for once a route needs it. */
  store: () => Store;
  start: () => StartDeps;
  intake: () => IntakeDeps;
  search: () => SearchDeps;
  examples: { slug: (runId: string) => ExampleSlug | null; events: (slug: ExampleSlug) => Promise<RunEvent[]>; report: (slug: ExampleSlug) => Promise<Report> };
  now?: () => number;
  /** Judges browser requests to the routes that spend (lib/bot-check.ts; allows everything by default). */
  botCheck?: () => BotCheck;
}

/** Another site's request, or one the bot check flags, is answered before anything is spent. */
async function refused(request: Request, deps: RouteDeps): Promise<Response | null> {
  return browserOnly(request, deps.botCheck ?? (() => allowAll));
}

const off = () => errorResponse(new ApiFailure("off", "Live runs are off right now. The examples show a full run.", 503));
const live = (deps: RouteDeps) => isLive(deps.env ?? process.env);

export async function postRun(request: Request, deps: RouteDeps): Promise<Response> {
  try {
    const input = runStartRequestSchema.parse(await request.json());
    if (!live(deps)) return json(exampleReply("replay"));
    const no = await refused(request, deps);
    if (no) return no;
    const store = deps.store();
    // The signed visitor cookie, minted here when the browser has none: the run's storyboards count
    // against it next to the IP (lib/media/storyboards.ts). Without STOOP_SIGNING_SECRET, the IP alone.
    const cookie = visitorCookie(request, signingSecret(deps.env ?? process.env));
    const reply = await startRun({ ...deps.start(), env: deps.env }, input, { ...(await contextFor(request, store)), cookieVisitor: cookie.id });
    const response = json(reply);
    if (cookie.setCookie) response.headers.append("Set-Cookie", cookie.setCookie);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function postResume(request: Request, id: string, deps: RouteDeps): Promise<Response> {
  try {
    const runId = liveRunIdSchema.parse(id);
    if (!live(deps)) return json(exampleReply("replay"));
    // A resume spends like a start (the rest of the run goes on live), so it is refused the same way.
    const no = await refused(request, deps);
    if (no) return no;
    const store = deps.store();
    return json(await resumeRun({ ...deps.start(), env: deps.env }, runId, await contextFor(request, store)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function postIntake(request: Request, deps: RouteDeps): Promise<Response> {
  try {
    const input = intakeRequestSchema.parse(await request.json());
    if (!live(deps)) return off();
    const no = await refused(request, deps);
    if (no) return no;
    const store = deps.store();
    return json(await runIntake({ ...deps.intake(), env: deps.env }, input, await contextFor(request, store)));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getSearch(request: Request, deps: RouteDeps): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    const input = searchRequestSchema.parse({ intakeId: query.get("intakeId"), q: query.get("q"), type: query.get("type") });
    if (!live(deps)) return off();
    const store = deps.store();
    return json(await searchSeeds({ ...deps.search(), env: deps.env }, input, await contextFor(request, store)));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * The run's events. A viewer reconnecting to a run that has ended, already holding its last event,
 * gets 204, which tells EventSource to stop reconnecting.
 */
export async function getEvents(request: Request, id: string, deps: RouteDeps): Promise<Response> {
  try {
    const lastEventId = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("lastEventId");
    const slug = deps.examples.slug(id);
    if (slug) {
      const events = await deps.examples.events(slug);
      const seen = lastEventId ? lastEventIdSchema.safeParse(lastEventId) : null;
      if (seen?.success && seen.data.seq >= (events.at(-1)?.seq ?? -1)) return new Response(null, { status: 204 });
      return new Response(streamExample(events, { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
    }
    const runId = liveRunIdSchema.parse(id);
    const store = deps.store();
    const meta = await getRunMeta(store, runId);
    if (!meta) throw new ApiFailure("not_found", "That run has expired.", 404);
    const seen = lastEventId ? lastEventIdSchema.safeParse(lastEventId) : null;
    if (seen?.success && seen.data.attempt === meta.attempt && (await liveStatus(store, meta, (deps.now ?? Date.now)())) !== "running") {
      const events = await readRunEvents(store, runId, meta.attempt);
      if (events.length && events.at(-1)!.seq === seen.data.seq) return new Response(null, { status: 204 });
    }
    return new Response(streamLiveRun(store, runId, { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getReport(id: string, deps: RouteDeps): Promise<Response> {
  try {
    const slug = deps.examples.slug(id);
    if (slug) return json({ status: "done", report: await deps.examples.report(slug), eventsUrl: null } satisfies ReportResponse);
    const runId = liveRunIdSchema.parse(id);
    const store = deps.store();
    const meta = await getRunMeta(store, runId);
    const eventsUrl = `/api/run/${runId}/events`;
    if (meta) {
      const status = await liveStatus(store, meta, (deps.now ?? Date.now)());
      if (status === "running" || status === "stopped") return json({ status: "running", runId, eventsUrl, resumable: status === "stopped" } satisfies ReportResponse);
    }
    const report = (await loadReport(store, runId)) ?? (meta ? await refreshReport(store, runId) : null);
    if (!report) throw new ApiFailure("not_found", "That report has expired.", 404);
    return json({ status: "done", report, eventsUrl: meta ? eventsUrl : null } satisfies ReportResponse);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getHealth(deps: RouteDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const caps = dailyCaps(env);
  const counted: (keyof typeof caps)[] = ["liveRuns", "frames", "qloo", "renders"];
  const capKey: Record<keyof typeof caps, DailyCap> = { liveRuns: "live-runs", frames: "frames", qloo: "qloo", renders: "renders" };
  const zero = Object.fromEntries(counted.map((name) => [name, { used: 0, cap: caps[name] }])) as HealthResponse["caps"];
  try {
    const store = deps.store();
    if (!(await store.ping())) throw new Error("unreachable");
    const used = await Promise.all(counted.map(async (name) => [name, { used: (await store.get<number>(keys.daily(capKey[name]))) ?? 0, cap: caps[name] }] as const));
    return json({ ok: true, live: isLive(env), store: store.kind, caps: Object.fromEntries(used) as HealthResponse["caps"], qlooMonthRemaining: (await lastMonthRemaining(store)) ?? null } satisfies HealthResponse);
  } catch {
    return json({ ok: false, live: isLive(env), store: "unreachable", caps: zero, qlooMonthRemaining: null } satisfies HealthResponse, 503);
  }
}
