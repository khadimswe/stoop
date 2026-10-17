// Stoop's MCP server (/api/mcp): two tools for other agents.
// - score_brief (sync): Qloo only, no LLM, no frames. Scores creative choices for an audience.
// - culture_brief (async): reads a product like /start does, then starts a run through the same
//   RunIntake and StartRun the web flow uses, so it gets the same caps, admission and guardrails (and
//   counts against LIVE_RUNS_DAILY_CAP inside StartRun). Returns the run id and where to follow it,
//   or an example replay and why.
// Listing tools is open; calling one needs a valid MCP token (lib/mcp/auth.ts), and each call takes its
// share of the token's and the day's caps right before it spends anything (lib/mcp/caps.ts).
// Everything is injected, so tests run both tools with fakes and the recorded Qloo fixtures.
import type { AuthInfo, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { intakeRequestSchema, RUN_SEEDS, type IntakeRequest } from "../api/requests";
import { REPLAY_REASONS, type IntakeResponse, type RunStartResponse } from "../api/responses";
import { dailyCaps, mcpCaps } from "../config";
import { LEAD_EXAMPLE } from "../demo/examples";
import { MONTHLY_FLOOR, SCORE_BRIEF_BUDGET, SCORE_BRIEF_CAP } from "../qloo/budget";
import type { QlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { lastMonthRemaining } from "../qloo/shared";
import { DAILY_RULES, EVERYONE, giveBack, hitRate, NOTHING_RESERVED, RATE_RULES, reserveUpTo, ruleCounter, type Reservation } from "../rate-limit";
import type { RequestContext, RunIntake, StartRun } from "../runtime/types";
import { keys } from "../store/keys";
import type { Store } from "../store/types";
import { tokenVisitorId, visitorId, type TokenVisitorId } from "../store/visitor";
import { DEFAULT_DIRECTION } from "../types";
import { callerOf, tokenRefusal, type Caller } from "./auth";
import { capRefusal, reserveCall } from "./caps";
import { scoreBrief, scoreBriefInputSchema, scoreBriefResultSchema, scoreBriefText } from "./score-brief";

export const MCP_SERVER_INFO = { name: "stoop", version: "0.1.0" } as const;

/** Seeds handed to StartRun: the /start step shows 3 to 5 of the intake's proposals. */
export const CULTURE_BRIEF_SEEDS = 5;

/** score_brief stops below this many Qloo calls left in the month: the floor live runs keep for themselves. */
export { MONTHLY_FLOOR };

/** Thrown by a RunIntake that is not wired yet: culture_brief answers with the example replay instead. */
export class RuntimeUnavailableError extends Error {
  override name = "RuntimeUnavailableError";
}

export interface McpDeps {
  store: () => Store;
  /** STOOP_LIVE: off means no live Qloo, Claude or fal call from either tool. */
  live: () => boolean;
  /** Whether score_brief may call Qloo: live, or QLOO_MODE=fixtures (replays only, nothing goes out). */
  scoring: () => boolean;
  qloo: () => QlooClient;
  runIntake: RunIntake;
  startRun: StartRun;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
}

type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const text = (message: string, isError = false): ToolResult => ({ content: [{ type: "text", text: message }], ...(isError ? { isError: true } : {}) });

/** The origin to build absolute links from: the request's own (agents need full URLs). */
function originOf(request: Request | undefined): string {
  if (!request) return "";
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * The context the tools and the runtime count by: the caller's token when it has one (hosted connectors
 * share server IPs, so an IP would pool many users), else the salted IP. A run it starts keeps this id
 * as its visitor, so the run's storyboards count against the token too (with no cookie id).
 */
async function requestContext(deps: McpDeps, request: Request | undefined, caller?: TokenVisitorId): Promise<RequestContext> {
  const store = deps.store();
  const startedAt = (deps.now ?? Date.now)();
  const visitor = caller ?? (await visitorId(store, request?.headers ?? new Headers()));
  return { store, visitor, cookieVisitor: null, source: "mcp", startedAt, ...(request?.signal ? { signal: request.signal } : {}) };
}

// --- culture_brief --------------------------------------------------------------------------------

const REPLAY_MESSAGES: Record<(typeof REPLAY_REASONS)[number], string> = {
  replay: "Live runs are off right now. Here's an example report while you wait.",
  busy: "Live runs are busy right now. Here's an example report while you wait.",
  "daily-cap": "Today's live runs are used up. Here's an example report; live runs open again tomorrow.",
  "rate-limited": "Too many briefs in the last hour. Here's an example report meanwhile.",
};

/** The answer StartRun gives when a start becomes an example replay. */
export function replayAnswer(reason: (typeof REPLAY_REASONS)[number]): Extract<RunStartResponse, { mode: "example" }> {
  return { mode: "example", slug: LEAD_EXAMPLE.slug, reason, message: REPLAY_MESSAGES[reason] };
}

/**
 * Stand-ins until the runtime's real RunIntake and StartRun are wired: every culture_brief answers
 * with the lead example's replay, and no page is read and no model or Qloo call is made.
 */
export const pendingRuntime: { runIntake: RunIntake; startRun: StartRun } = {
  runIntake: async () => {
    throw new RuntimeUnavailableError("Live runs through MCP are not wired yet.");
  },
  startRun: async () => replayAnswer("replay"),
};

/**
 * One flat object (MCP output schemas must be objects), keyed by `mode`: "live" carries the run and
 * its links, "example" the replay and why, "no_seeds" why no run started, "capped" which of the
 * token's or the day's MCP caps is spent.
 */
export const cultureBriefOutputSchema = z.strictObject({
  mode: z.enum(["live", "example", "no_seeds", "capped"]),
  message: z.string(),
  runId: z.string().optional(),
  reportUrl: z.string().optional(),
  eventsUrl: z.string().optional(),
  joined: z.boolean().optional(),
  seeds: z.array(z.strictObject({ name: z.string(), origin: z.string() })).optional(),
  slug: z.string().optional(),
  reason: z.enum(REPLAY_REASONS).optional(),
  notes: z.array(z.string()).optional(),
});
export type CultureBriefOutput = z.infer<typeof cultureBriefOutputSchema>;

const exampleLink = (origin: string, slug: string) => `${origin}/examples/${slug}`;

/**
 * Called right before intake spends anything (a page read, Claude, Qloo): a reservation lets it run,
 * or an answer is given instead. The reservation is kept once the brief comes back after intake, and
 * given back when intake never ran or the brief failed.
 */
export type IntakeGate = () => Promise<{ ok: true; reservation: Reservation } | { ok: false; output: CultureBriefOutput }>;

export interface CultureBriefOptions {
  gate?: IntakeGate;
  /** The caller's token id: the hourly limit, StartRun's limits and the run's storyboards count by it instead of the IP. */
  caller?: TokenVisitorId;
}

export async function cultureBrief(input: IntakeRequest, deps: McpDeps, request?: Request, options: CultureBriefOptions = {}): Promise<CultureBriefOutput> {
  const { gate } = options;
  const origin = originOf(request);
  const example = (answer: Extract<RunStartResponse, { mode: "example" }>): CultureBriefOutput => ({ ...answer, reportUrl: exampleLink(origin, answer.slug) });
  const replay = (reason: (typeof REPLAY_REASONS)[number]) => example(replayAnswer(reason));
  // STOOP_LIVE off: intake would read a page and call Claude and Qloo, so nothing runs.
  if (!deps.live()) return replay("replay");
  const ctx = await requestContext(deps, request, options.caller);
  const rate = await hitRate(ctx.store, RATE_RULES.cultureBrief, ctx.visitor, deps.now?.());
  if (!rate.ok) return replay("rate-limited");
  // A spent daily cap answers before intake spends anything. Only a read: StartRun does the counting.
  const usedToday = (await ctx.store.get<number>(keys.daily("live-runs"))) ?? 0;
  if (usedToday >= dailyCaps(deps.env).liveRuns) return replay("daily-cap");

  const held = gate ? await gate() : { ok: true as const, reservation: NOTHING_RESERVED };
  if (!held.ok) return held.output;
  try {
    let intake: IntakeResponse;
    try {
      intake = await deps.runIntake(input, ctx);
    } catch (error) {
      if (error instanceof RuntimeUnavailableError) {
        await held.reservation.release();
        return replay("replay");
      }
      throw error;
    }
    const seeds = intake.seeds.slice(0, CULTURE_BRIEF_SEEDS);
    if (seeds.length < RUN_SEEDS.min) {
      return {
        mode: "no_seeds",
        message: `Qloo matched ${seeds.length} ${seeds.length === 1 ? "seed" : "seeds"} for this product; a run needs at least ${RUN_SEEDS.min}. Try a product page link or a fuller description.`,
        notes: intake.notes,
      };
    }
    const started = await deps.startRun(
      { intakeId: intake.intakeId, seedIds: seeds.map((s) => s.ref.id), statedCustomer: input.statedCustomer ?? null, region: input.region ?? "United States", direction: DEFAULT_DIRECTION },
      ctx,
    );
    if (started.mode === "example") return example(started);
    return {
      mode: "live",
      message: started.joined
        ? "The same brief was already running, so this joined it. Open the report link to follow it."
        : "The run takes a few minutes. Open the report link to watch it build, or read the events link as a server-sent event stream.",
      runId: started.runId,
      reportUrl: `${origin}${started.reportUrl}`,
      eventsUrl: `${origin}${started.eventsUrl}`,
      joined: started.joined,
      seeds: seeds.map((s) => ({ name: s.ref.name, origin: s.origin })),
    };
  } catch (error) {
    // A brief that failed gives its share of the caps back.
    await held.reservation.release().catch(() => undefined);
    throw error;
  }
}

function cultureBriefText(output: CultureBriefOutput): string {
  if (output.mode === "live") {
    const seeds = (output.seeds ?? []).map((s) => `${s.name} (${s.origin})`).join(", ");
    return [`Started run ${output.runId}${output.joined ? " (joined a run of the same brief)" : ""}.`, `Report: ${output.reportUrl}`, `Events: ${output.eventsUrl}`, `Seeds Qloo measures from: ${seeds}.`, output.message].join("\n");
  }
  if (output.mode === "example") return `${output.message}\nExample report: ${output.reportUrl}`;
  return [output.message, ...(output.notes ?? [])].join("\n");
}

// --- Tokens ---------------------------------------------------------------------------------------

/** The part of a tool call's context the token check reads. */
interface CallContext {
  http?: { authInfo?: AuthInfo; req?: Request };
}

/** A tool call goes on only with a valid token; anything else gets the refusal and the link to /mcp. */
function authorize(ctx: CallContext): { ok: true; caller: Extract<Caller, { status: "valid" }> } | { ok: false; result: ToolResult } {
  const caller = callerOf(ctx.http?.authInfo);
  if (caller.status === "valid") return { ok: true, caller };
  return { ok: false, result: text(tokenRefusal(caller.status, originOf(ctx.http?.req)), true) };
}

// --- The server -----------------------------------------------------------------------------------

const SCORE_DESCRIPTION =
  "Checks creative choices for an ad against the audience around a product, with Qloo's taste data. Give 2 to 5 seeds (things the customers also love) and the choices (music styles, moods, brands, films, TV, artists). Each choice comes back supported, below the reference median, no measurable affinity, or unverifiable, with its position against a frozen reference panel (\"beats 23 of 25 reference artists\") and Qloo's own top picks. No store data: it measures the product's taste neighborhood. Qloo only, no AI model. Needs a free Stoop MCP token (from the /mcp page), sent as \"Authorization: Bearer <token>\".";
const CULTURE_DESCRIPTION =
  "Starts a Stoop culture brief for a product: give a product or store link, or a description. Stoop reads the page, proposes seeds Qloo can match, and starts a run that maps the audience around the product, builds a Culture Brief per concept world and writes a production pack. Returns right away with the run id and links to follow it, or an example report when live runs are off, busy or used up for the day. Needs a free Stoop MCP token (from the /mcp page); each token can use up to 3 briefs a day.";

/** Registers both tools. Pass it to createMcpHandler; it is called once per request. */
export function buildMcpServer(deps: McpDeps): (server: McpServer) => void {
  return (server) => {
    server.registerTool(
      "score_brief",
      { title: "Score creative choices with Qloo", description: SCORE_DESCRIPTION, inputSchema: scoreBriefInputSchema, outputSchema: scoreBriefResultSchema, annotations: { readOnlyHint: true, openWorldHint: true } },
      async (input, ctx): Promise<ToolResult> => {
        const auth = authorize(ctx);
        if (!auth.ok) return auth.result;
        if (!deps.scoring()) return text(`Live scoring is off right now. The examples show the same check: ${exampleLink(originOf(ctx.http?.req), LEAD_EXAMPLE.slug)}`, true);
        const rc = await requestContext(deps, ctx.http?.req, tokenVisitorId(auth.caller.hash));
        const now = deps.now?.() ?? Date.now();
        const rate = await hitRate(rc.store, RATE_RULES.scoreBrief, rc.visitor, now);
        if (!rate.ok) return text(`Too many scores with this token. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`, true);
        const caps = mcpCaps(deps.env);
        const calls = await reserveCall(rc.store, auth.caller.hash, "score_brief", caps, now);
        if (!calls.ok) return text(capRefusal(calls.full, caps), true);
        let scored = false;
        try {
          // All agents together get a daily slice of Qloo calls. A call reserves its whole cap from the
          // slice before it starts (so concurrent calls can never overshoot it) and gives back what it did not spend.
          const slice = ruleCounter(DAILY_RULES.scoreBriefQloo, EVERYONE, now);
          const granted = await reserveUpTo(rc.store, slice.key, SCORE_BRIEF_CAP, DAILY_RULES.scoreBriefQloo.limit, slice.ttlSeconds);
          if (granted === 0) return text("Today's scoring budget is used up. It opens again tomorrow (UTC).", true);
          const qlooCtx = createRunContext({ runId: `mcp-score-${crypto.randomUUID()}`, cap: granted, rowCaps: SCORE_BRIEF_BUDGET, monthlyFloor: MONTHLY_FLOOR });
          try {
            // The last x-month-ratelimit-remaining any call saw, so this call stops at the same floor live runs keep.
            const monthRemaining = await lastMonthRemaining(rc.store, now);
            if (monthRemaining !== undefined) qlooCtx.monthRemaining = monthRemaining;
            const result = await scoreBrief(input, { client: deps.qloo(), ctx: qlooCtx });
            scored = true;
            return { content: [{ type: "text", text: scoreBriefText(result) }], structuredContent: result };
          } finally {
            await giveBack(rc.store, slice.key, granted - qlooCtx.liveCalls, slice.ttlSeconds);
          }
        } finally {
          // A refused or failed call gives its share of the token's and the day's calls back.
          if (!scored) await calls.reservation.release();
        }
      },
    );
    server.registerTool(
      "culture_brief",
      { title: "Start a Stoop culture brief", description: CULTURE_DESCRIPTION, inputSchema: intakeRequestSchema, outputSchema: cultureBriefOutputSchema, annotations: { readOnlyHint: false, openWorldHint: true } },
      async (input, ctx): Promise<ToolResult> => {
        const auth = authorize(ctx);
        if (!auth.ok) return auth.result;
        const caps = mcpCaps(deps.env);
        // The token's calls and briefs are taken right before intake, after the cheap refusals.
        const output = await cultureBrief(input, deps, ctx.http?.req, {
          caller: tokenVisitorId(auth.caller.hash),
          gate: async () => {
            const reserved = await reserveCall(deps.store(), auth.caller.hash, "culture_brief", caps, deps.now?.() ?? Date.now());
            return reserved.ok ? reserved : { ok: false, output: { mode: "capped", message: capRefusal(reserved.full, caps) } };
          },
        });
        return { content: [{ type: "text", text: cultureBriefText(output) }], structuredContent: output, ...(output.mode === "no_seeds" || output.mode === "capped" ? { isError: true } : {}) };
      },
    );
  };
}
