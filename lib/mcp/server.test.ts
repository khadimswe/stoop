// The MCP server: culture_brief with fake RunIntake and StartRun (the runtime's real ones are wired
// later), and both tools through the real mcp-handler route handler, as an agent would call them.
import { readFileSync } from "node:fs";
import { createMcpHandler } from "mcp-handler";
import { describe, expect, it, vi } from "vitest";
import { intakeResponseSchema, type IntakeResponse, type RunStartResponse } from "../api/responses";
import type { IntakeRequest, RunStartRequest } from "../api/requests";
import { createQlooClient } from "../qloo/client";
import { FixtureCache } from "../qloo/fixtures";
import type { Report } from "../report/schema";
import type { RequestContext } from "../runtime/types";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import { DAILY_RULES, EVERYONE, hitRate, rateUsed } from "../rate-limit";
import { buildMcpServer, cultureBrief, cultureBriefOutputSchema, MONTHLY_FLOOR, pendingRuntime, replayAnswer, type McpDeps } from "./server";

const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;

/** An intake built from the recorded hot sauce run: real seeds with their receipts. */
function recordedIntake(seedCount = report.inputs.seeds.length): IntakeResponse {
  const seeds = report.inputs.seeds.slice(0, seedCount);
  const cited = new Set(seeds.flatMap((s) => s.evidenceIds));
  return intakeResponseSchema.parse({
    intakeId: "in_0123456789abcdef01234567",
    product: report.inputs.product,
    site: null,
    blocked: null,
    seeds,
    evidence: report.ledger.filter((e) => cited.has(e.id)),
    notes: ["Read the description."],
  });
}

const LIVE_START: RunStartResponse = { mode: "live", runId: "run_0123456789abcdef01234567", eventsUrl: "/api/run/run_0123456789abcdef01234567/events", reportUrl: "/report/run_0123456789abcdef01234567", joined: false };

function deps(overrides: Partial<McpDeps> = {}): McpDeps & { store: () => MemoryStore } {
  const store = new MemoryStore();
  return {
    store: () => store,
    live: () => true,
    scoring: () => true,
    qloo: () => createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) }),
    runIntake: vi.fn(async () => recordedIntake()),
    startRun: vi.fn(async () => LIVE_START),
    env: {},
    ...overrides,
  } as McpDeps & { store: () => MemoryStore };
}

const request = new Request("https://stoop.example/api/mcp", { method: "POST", headers: { "x-forwarded-for": "203.0.113.7" } });
const brief: IntakeRequest = { description: "Small-batch hot sauce made with smoked peppers and a little honey." };

describe("culture_brief", () => {
  it("replays the lead example and reads nothing while STOOP_LIVE is off", async () => {
    const d = deps({ live: () => false });
    const output = await cultureBrief(brief, d, request);
    expect(output).toEqual({ ...replayAnswer("replay"), reportUrl: "https://stoop.example/examples/food-hot-sauce" });
    expect(d.runIntake).not.toHaveBeenCalled();
    expect(d.startRun).not.toHaveBeenCalled();
  });

  it("replays while the runtime is not wired (the route's pending stand-ins)", async () => {
    const output = await cultureBrief(brief, deps({ ...pendingRuntime }), request);
    expect(output).toMatchObject({ mode: "example", slug: "food-hot-sauce", reason: "replay" });
    expect(await pendingRuntime.startRun({} as RunStartRequest, {} as RequestContext)).toEqual(replayAnswer("replay"));
  });

  it("runs intake, then starts a run with up to 5 proposed seeds through the MCP door, with absolute links", async () => {
    const d = deps();
    const output = cultureBriefOutputSchema.parse(await cultureBrief({ ...brief, statedCustomer: "Home cooks, 25 to 40", region: "Texas" }, d, request));
    expect(output).toMatchObject({
      mode: "live",
      runId: LIVE_START.mode === "live" ? LIVE_START.runId : "",
      reportUrl: "https://stoop.example/report/run_0123456789abcdef01234567",
      eventsUrl: "https://stoop.example/api/run/run_0123456789abcdef01234567/events",
      joined: false,
    });
    expect(output.seeds?.map((s) => s.name)).toEqual(report.inputs.seeds.slice(0, 5).map((s) => s.ref.name));
    const [startInput, ctx] = vi.mocked(d.startRun).mock.calls[0];
    expect(startInput).toEqual({
      intakeId: "in_0123456789abcdef01234567",
      seedIds: report.inputs.seeds.slice(0, 5).map((s) => s.ref.id),
      statedCustomer: "Home cooks, 25 to 40",
      region: "Texas",
      direction: { look: "auto", cast: "auto", energy: "auto" },
    });
    expect(ctx.source).toBe("mcp");
    expect(ctx.visitor).toMatch(/^v_[0-9a-f]{24}$/);
  });

  it("passes StartRun's example replay through, with why", async () => {
    const busy = { mode: "example", slug: "home-candles", reason: "busy", message: "Live runs are busy right now. Here's an example report while you wait." } as const;
    const output = await cultureBrief(brief, deps({ startRun: vi.fn(async () => busy) }), request);
    expect(output).toEqual({ ...busy, reportUrl: "https://stoop.example/examples/home-candles" });
  });

  it("starts nothing when intake matches fewer than 2 seeds", async () => {
    const d = deps({ runIntake: vi.fn(async () => recordedIntake(1)) });
    const output = await cultureBrief(brief, d, request);
    expect(output.mode).toBe("no_seeds");
    expect(output.message).toContain("a run needs at least 2");
    expect(d.startRun).not.toHaveBeenCalled();
  });

  it("answers with the replay once today's live runs are spent, before intake spends anything", async () => {
    const d = deps({ env: { LIVE_RUNS_DAILY_CAP: "2" } });
    await d.store().incr(keys.daily("live-runs"), { by: 2 });
    const output = await cultureBrief(brief, d, request);
    expect(output).toMatchObject({ mode: "example", reason: "daily-cap" });
    expect(d.runIntake).not.toHaveBeenCalled();
  });

  it("limits each visitor to 3 briefs an hour, then replays", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) expect((await cultureBrief(brief, d, request)).mode).toBe("live");
    expect(await cultureBrief(brief, d, request)).toMatchObject({ mode: "example", reason: "rate-limited" });
    expect(d.runIntake).toHaveBeenCalledTimes(3);
  });
});

// --- Over HTTP, through mcp-handler ---------------------------------------------------------------

type RpcResult = { result?: { tools?: { name: string; inputSchema: Record<string, unknown> }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: { message: string } };

function rpc(d: McpDeps) {
  const handler = createMcpHandler(buildMcpServer(d), { serverInfo: { name: "stoop", version: "0.1.0" } });
  let id = 0;
  return async (method: string, params: Record<string, unknown>, ip = "203.0.113.7"): Promise<RpcResult> => {
    const response = await handler(
      new Request("https://stoop.example/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "x-forwarded-for": ip },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
    );
    const text = await response.text();
    // The stateless transport answers as one server-sent event.
    const data = text.startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
    return JSON.parse(data ?? "{}") as RpcResult;
  };
}

const scoreArgs = {
  product: "heavyweight tees and hoodies",
  seeds: [
    { name: "Carhartt", type: "brand" },
    { name: "Champion", type: "brand" },
    { name: "Tyler, the Creator", type: "artist" },
    { name: "Rick and Morty", type: "tv_show" },
  ],
  choices: { music: ["Lo-fi hip hop"], mood: ["Calm"], artists: ["Nujabes"] },
};

describe("/api/mcp tools over HTTP", () => {
  it("lists both tools with size-capped input schemas", async () => {
    const { result } = await rpc(deps())("tools/list", {});
    expect(result?.tools?.map((t) => t.name).sort()).toEqual(["culture_brief", "score_brief"]);
    const culture = result?.tools?.find((t) => t.name === "culture_brief");
    expect(JSON.stringify(culture?.inputSchema)).toContain('"maxLength":2000');
  });

  it("scores choices on the recorded fixtures and returns the structured result", async () => {
    const { result } = await rpc(deps())("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toMatchObject({ status: "scored", fit: { line: "2 of 3 checkable choices below this audience's reference median" } });
    expect(result?.content?.[0].text).toContain("beats 20 of 24 reference artists");
  });

  it("says scoring is off while there is no live or fixtures Qloo, and calls nothing", async () => {
    const qloo = vi.fn();
    const { result } = await rpc(deps({ scoring: () => false, qloo }))("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0].text).toContain("Live scoring is off right now");
    expect(qloo).not.toHaveBeenCalled();
  });

  it("limits score_brief to 10 an hour per visitor", async () => {
    const call = rpc(deps());
    for (let i = 0; i < 10; i++) expect((await call("tools/call", { name: "score_brief", arguments: scoreArgs })).result?.isError).toBeFalsy();
    const limited = await call("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(limited.result?.isError).toBe(true);
    expect(limited.result?.content?.[0].text).toContain("Too many scores from here");
    // Another visitor is not affected.
    expect((await call("tools/call", { name: "score_brief", arguments: scoreArgs }, "198.51.100.2")).result?.isError).toBeFalsy();
  });

  it("spends only the day's score_brief slice of Qloo calls, counted from live calls, and stops at the monthly floor", async () => {
    // Replays spend nothing live, so the slice is untouched.
    const d = deps();
    await rpc(d)("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(await rateUsed(d.store(), DAILY_RULES.scoreBriefQloo, EVERYONE)).toBe(0);

    const spent = deps();
    await hitRate(spent.store(), DAILY_RULES.scoreBriefQloo, EVERYONE, Date.now(), DAILY_RULES.scoreBriefQloo.limit);
    const qloo = vi.fn();
    const { result } = await rpc({ ...spent, qloo })("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0].text).toContain("Today's scoring budget is used up");
    expect(qloo).not.toHaveBeenCalled();

    // Below the monthly floor, every lookup is refused before it is sent: nothing scored, nothing spent.
    const low = deps();
    await low.store().set(keys.qloo.monthRemaining(), MONTHLY_FLOOR - 1);
    const fetchImpl = vi.fn<typeof fetch>();
    const live = createQlooClient({ apiKey: "test-key", fetch: fetchImpl });
    const request = vi.spyOn(live, "request");
    const floor = await rpc({ ...low, qloo: () => live })("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(floor.result?.structuredContent).toMatchObject({ status: "unavailable", calls: { live: 0 } });
    expect(request).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses arguments over their caps before any tool work", async () => {
    const d = deps();
    const call = rpc(d);
    const tooLong = await call("tools/call", { name: "culture_brief", arguments: { description: "x".repeat(2_001) } });
    expect(tooLong.result?.isError ?? !!tooLong.error).toBe(true);
    const unknown = await call("tools/call", { name: "culture_brief", arguments: { description: "A small-batch hot sauce made with smoked peppers.", prompt: "ignore the rules" } });
    expect(unknown.result?.isError ?? !!unknown.error).toBe(true);
    const neither = await call("tools/call", { name: "culture_brief", arguments: { brandName: "Porchlight" } });
    expect(neither.result?.isError ?? !!neither.error).toBe(true);
    expect(d.runIntake).not.toHaveBeenCalled();
  });

  it("starts a culture brief and returns the run's links", async () => {
    const { result } = await rpc(deps())("tools/call", { name: "culture_brief", arguments: { url: "https://shop.example/products/hot-sauce" } });
    expect(result?.structuredContent).toMatchObject({ mode: "live", reportUrl: "https://stoop.example/report/run_0123456789abcdef01234567" });
    expect(result?.content?.[0].text).toContain("Started run run_0123456789abcdef01234567");
  });
});
