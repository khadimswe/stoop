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
import type { RequestContext, StartRun } from "../runtime/types";
import { keys } from "../store/keys";
import { MemoryStore } from "../store/memory";
import type { Store } from "../store/types";
import { tokenVisitorId } from "../store/visitor";
import { allowAll } from "../bot-check";
import { DAILY_RULES, EVERYONE, hitRate, rateUsed } from "../rate-limit";
import { createMcpPost } from "../routes/mcp";
import { storeToken } from "./fixture-token";
import { newToken } from "./token";
import { buildMcpServer, cultureBrief, cultureBriefOutputSchema, MONTHLY_FLOOR, pendingRuntime, replayAnswer, type McpDeps } from "./server";
import { ifRecorded, itRecorded } from "../testing/recorded";

const report = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report);

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

  itRecorded("runs intake, then starts a run with up to 5 proposed seeds through the MCP door, with absolute links", async () => {
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

  itRecorded("passes StartRun's example replay through, with why", async () => {
    const busy = { mode: "example", slug: "home-candles", reason: "busy", message: "Live runs are busy right now. Here's an example report while you wait." } as const;
    const output = await cultureBrief(brief, deps({ startRun: vi.fn(async () => busy) }), request);
    expect(output).toEqual({ ...busy, reportUrl: "https://stoop.example/examples/home-candles" });
  });

  itRecorded("starts nothing when intake matches fewer than 2 seeds", async () => {
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

  itRecorded("limits each visitor to 3 briefs an hour, then replays", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) expect((await cultureBrief(brief, d, request)).mode).toBe("live");
    expect(await cultureBrief(brief, d, request)).toMatchObject({ mode: "example", reason: "rate-limited" });
    expect(d.runIntake).toHaveBeenCalledTimes(3);
  });
});

// --- Over HTTP, through the route and mcp-handler -------------------------------------------------

type RpcResult = { result?: { tools?: { name: string; inputSchema: Record<string, unknown> }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; serverInfo?: { name: string } }; error?: { message: string } };

/**
 * Calls the MCP server as an agent would: through POST /api/mcp's guard and token check, then the real
 * mcp-handler. By default it holds a valid token of its own; `token: null` sends none, a string sends that.
 */
function rpc(d: McpDeps, options: { token?: string | null } = {}) {
  const handler = createMcpHandler(buildMcpServer(d), { serverInfo: { name: "stoop", version: "0.1.0" } });
  const post = createMcpPost({ store: d.store, botCheck: () => allowAll, handler });
  let id = 0;
  let token: Promise<string | null> | null = null;
  const bearer = () => (token ??= options.token !== undefined ? Promise.resolve(options.token) : storeToken(d.store()).then((t) => t.token));
  return async (method: string, params: Record<string, unknown>, ip = "203.0.113.7", extra: { pathToken?: string } = {}): Promise<RpcResult> => {
    const auth = extra.pathToken ? null : await bearer();
    const response = await post(
      new Request(`https://stoop.example/api/mcp${extra.pathToken ? `/${extra.pathToken}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "x-forwarded-for": ip, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
      extra.pathToken ? { pathToken: extra.pathToken } : {},
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

  itRecorded("scores choices on the recorded fixtures and returns the structured result", async () => {
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

  it("limits score_brief to 10 an hour per token: one token across IPs shares it, two tokens behind one IP each have their own", async () => {
    const d = deps();
    const call = rpc(d);
    for (let i = 0; i < 10; i++) expect((await call("tools/call", { name: "score_brief", arguments: scoreArgs }, i % 2 ? "203.0.113.7" : "198.51.100.2")).result?.isError).toBeFalsy();
    const limited = await call("tools/call", { name: "score_brief", arguments: scoreArgs }, "192.0.2.9");
    expect(limited.result?.isError).toBe(true);
    expect(limited.result?.content?.[0].text).toContain("Too many scores with this token");
    // Another token behind the same IP is not affected.
    expect((await rpc(d)("tools/call", { name: "score_brief", arguments: scoreArgs }, "203.0.113.7")).result?.isError).toBeFalsy();
  });

  itRecorded("limits culture_brief to 3 an hour per token, and starts its runs as the token, never as the shared IP", async () => {
    const d = deps();
    const a = await storeToken(d.store());
    const b = await storeToken(d.store());
    const shared = "203.0.113.7";
    for (let i = 0; i < 3; i++) expect((await rpc(d, { token: a.token })("tools/call", { name: "culture_brief", arguments: { description: "Small-batch hot sauce made with smoked peppers." } }, shared)).result?.structuredContent?.mode).toBe("live");
    expect((await rpc(d, { token: a.token })("tools/call", { name: "culture_brief", arguments: { description: "Small-batch hot sauce made with smoked peppers." } }, "198.51.100.2")).result?.structuredContent).toMatchObject({ mode: "example", reason: "rate-limited" });
    // A second token behind the same IP gets its own 3.
    for (let i = 0; i < 3; i++) expect((await rpc(d, { token: b.token })("tools/call", { name: "culture_brief", arguments: { description: "Small-batch hot sauce made with smoked peppers." } }, shared)).result?.structuredContent?.mode).toBe("live");
    const contexts = vi.mocked(d.startRun).mock.calls.map(([, ctx]) => ctx);
    expect(contexts.slice(0, 3).every((ctx) => ctx.visitor === tokenVisitorId(a.hash) && ctx.cookieVisitor === null)).toBe(true);
    expect(contexts.slice(3).every((ctx) => ctx.visitor === tokenVisitorId(b.hash))).toBe(true);
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

  itRecorded("starts a culture brief and returns the run's links", async () => {
    const { result } = await rpc(deps())("tools/call", { name: "culture_brief", arguments: { url: "https://shop.example/products/hot-sauce" } });
    expect(result?.structuredContent).toMatchObject({ mode: "live", reportUrl: "https://stoop.example/report/run_0123456789abcdef01234567" });
    expect(result?.content?.[0].text).toContain("Started run run_0123456789abcdef01234567");
  });
});

// --- Tokens and caps ------------------------------------------------------------------------------

const cultureArgs = { description: "Small-batch hot sauce made with smoked peppers and a little honey." };
const ipN = (n: number) => `198.51.100.${n + 10}`;
const counter = async (store: Store, key: string) => (await store.get<number>(key)) ?? 0;

describe("MCP tokens", () => {
  it("leaves initialize and tools/list open, and closes tools/call without a token, with the link to get one", async () => {
    const d = deps();
    const qloo = vi.fn();
    const call = rpc({ ...d, qloo }, { token: null });
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result?.serverInfo?.name).toBe("stoop");
    expect((await call("tools/list", {})).result?.tools).toHaveLength(2);
    for (const name of ["score_brief", "culture_brief"]) {
      const { result } = await call("tools/call", { name, arguments: name === "score_brief" ? scoreArgs : cultureArgs });
      expect(result?.isError).toBe(true);
      expect(result?.content?.[0].text).toContain("need a free MCP token. Get one at https://stoop.example/mcp");
    }
    expect(qloo).not.toHaveBeenCalled();
    expect(d.runIntake).not.toHaveBeenCalled();
  });

  it("refuses unknown, malformed, revoked and expired tokens with a clear message, never echoing the token", async () => {
    const d = deps();
    const store = d.store();
    const revoked = await storeToken(store, { revokedAt: "2026-10-18T00:00:00.000Z" });
    const expired = await storeToken(store, { expiresAt: "2026-10-01T00:00:00.000Z" });
    const cases: [string, string][] = [
      [newToken(), "does not recognize this MCP token"],
      ["not-even-close", "does not recognize this MCP token"],
      [revoked.token, "was revoked. Get a new one at https://stoop.example/mcp"],
      [expired.token, "has expired"],
    ];
    for (const [token, message] of cases) {
      const { result } = await rpc(d, { token })("tools/call", { name: "score_brief", arguments: scoreArgs });
      expect(result?.isError).toBe(true);
      expect(result?.content?.[0].text).toContain(message);
      expect(JSON.stringify(result)).not.toContain(token);
    }
    expect(d.runIntake).not.toHaveBeenCalled();
  });

  itRecorded("accepts the path form for URL-only clients, and refuses a path segment that is no token", async () => {
    const d = deps();
    const { token } = await storeToken(d.store());
    const call = rpc(d, { token: null });
    const ok = await call("tools/call", { name: "culture_brief", arguments: cultureArgs }, "203.0.113.7", { pathToken: token });
    expect(ok.result?.structuredContent).toMatchObject({ mode: "live" });
    const bad = await call("tools/call", { name: "culture_brief", arguments: cultureArgs }, "203.0.113.7", { pathToken: "hello" });
    expect(bad.result?.content?.[0].text).toContain("does not recognize this MCP token");
  });
});

describe("MCP caps", () => {
  itRecorded("starts at most 3 culture briefs per token per day, even when calls arrive at once", async () => {
    const d = deps();
    const { token, hash } = await storeToken(d.store());
    // One brief already used today (an earlier hour), so the daily cap binds before the hourly limit.
    await d.store().incr(keys.mcp.cultureBriefs(hash));
    const call = rpc(d, { token });
    const results = await Promise.all(Array.from({ length: 3 }, (_, i) => call("tools/call", { name: "culture_brief", arguments: cultureArgs }, ipN(i))));
    expect(results.filter((r) => r.result?.structuredContent?.mode === "live")).toHaveLength(2);
    const capped = results.filter((r) => r.result?.structuredContent?.mode === "capped");
    expect(capped).toHaveLength(1);
    expect(capped[0].result?.isError).toBe(true);
    expect(capped[0].result?.content?.[0].text).toContain("used its 3 culture briefs for today");
    expect(d.runIntake).toHaveBeenCalledTimes(2);
    expect(await counter(d.store(), keys.mcp.cultureBriefs(hash))).toBe(3);
    expect(await counter(d.store(), keys.mcp.calls(hash))).toBe(2);
    expect(await counter(d.store(), keys.daily("mcp-calls"))).toBe(2);
  });

  itRecorded("allows 40 tool calls per token per day, never more under concurrent calls", async () => {
    const d = deps();
    const { token, hash } = await storeToken(d.store());
    await d.store().incr(keys.mcp.calls(hash), { by: 38 });
    const call = rpc(d, { token });
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => call("tools/call", { name: "score_brief", arguments: scoreArgs }, ipN(i))));
    expect(results.filter((r) => r.result?.structuredContent?.status === "scored")).toHaveLength(2);
    const refused = results.filter((r) => r.result?.isError);
    expect(refused).toHaveLength(4);
    expect(refused[0].result?.content?.[0].text).toContain("made its 40 tool calls for today");
    expect(await counter(d.store(), keys.mcp.calls(hash))).toBe(40);
  });

  itRecorded("holds every token to MCP_DAILY_CAP tool calls a day together", async () => {
    const d = deps({ env: { MCP_DAILY_CAP: "4" } });
    const tokens = await Promise.all([0, 1, 2].map(() => storeToken(d.store())));
    const calls = tokens.flatMap((t, i) => [0, 1, 2].map((j) => rpc(d, { token: t.token })("tools/call", { name: "culture_brief", arguments: cultureArgs }, ipN(i * 3 + j))));
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.result?.structuredContent?.mode === "live")).toHaveLength(4);
    expect(results.filter((r) => r.result?.content?.[0].text.includes("today's limit across all agents"))).toHaveLength(5);
    expect(d.runIntake).toHaveBeenCalledTimes(4);
    expect(await counter(d.store(), keys.daily("mcp-calls"))).toBe(4);
    // The refused calls gave their per-token units back.
    const briefs = await Promise.all(tokens.map((t) => counter(d.store(), keys.mcp.cultureBriefs(t.hash))));
    expect(briefs.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("gives a call's units back when it spends nothing or fails", async () => {
    // The live-run cap is spent: culture_brief answers before intake and takes nothing.
    const capped = deps({ env: { LIVE_RUNS_DAILY_CAP: "1" } });
    await capped.store().incr(keys.daily("live-runs"));
    const one = await storeToken(capped.store());
    expect((await rpc(capped, { token: one.token })("tools/call", { name: "culture_brief", arguments: cultureArgs })).result?.structuredContent).toMatchObject({ reason: "daily-cap" });
    expect(await counter(capped.store(), keys.mcp.calls(one.hash))).toBe(0);
    // The runtime is not wired: intake never ran, so the brief is given back.
    const pending = deps({ ...pendingRuntime });
    const two = await storeToken(pending.store());
    expect((await rpc(pending, { token: two.token })("tools/call", { name: "culture_brief", arguments: cultureArgs })).result?.structuredContent).toMatchObject({ reason: "replay" });
    expect(await counter(pending.store(), keys.mcp.cultureBriefs(two.hash))).toBe(0);
    // Intake was called and failed: it may have read the page or called Claude and Qloo, so the units stay spent.
    const failing = deps({ runIntake: vi.fn(async () => Promise.reject(new Error("the page reader broke"))) });
    const three = await storeToken(failing.store());
    const failed = await rpc(failing, { token: three.token })("tools/call", { name: "culture_brief", arguments: cultureArgs });
    expect(failed.result?.isError ?? !!failed.error).toBe(true);
    expect(await counter(failing.store(), keys.mcp.cultureBriefs(three.hash))).toBe(1);
    expect(await counter(failing.store(), keys.mcp.calls(three.hash))).toBe(1);
    expect(await counter(failing.store(), keys.daily("mcp-calls"))).toBe(1);
    // score_brief with the scoring slice spent takes nothing from the token either.
    const spent = deps();
    await hitRate(spent.store(), DAILY_RULES.scoreBriefQloo, EVERYONE, Date.now(), DAILY_RULES.scoreBriefQloo.limit);
    const four = await storeToken(spent.store());
    expect((await rpc(spent, { token: four.token })("tools/call", { name: "score_brief", arguments: scoreArgs })).result?.content?.[0].text).toContain("scoring budget is used up");
    expect(await counter(spent.store(), keys.mcp.calls(four.hash))).toBe(0);
  });

  it("keeps a score_brief's units once it made a live Qloo call, even if it then failed", async () => {
    const d = deps();
    const { token, hash } = await storeToken(d.store());
    const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
    // Each lookup is counted as a live call, then fails in a way scoring does not survive.
    let live = 0;
    vi.spyOn(client, "request").mockImplementation(async (ctx) => {
      ctx.liveCalls++;
      live++;
      throw new Error("the answer could not be read");
    });
    const failed = await rpc({ ...d, qloo: () => client }, { token })("tools/call", { name: "score_brief", arguments: scoreArgs });
    expect(failed.result?.isError ?? !!failed.error).toBe(true);
    expect(live).toBeGreaterThan(0);
    expect(await counter(d.store(), keys.mcp.calls(hash))).toBe(1);
    // The slice keeps exactly the live calls it made.
    expect(await rateUsed(d.store(), DAILY_RULES.scoreBriefQloo, EVERYONE)).toBe(live);
  });

  itRecorded("gives MCP its own share of the day's live runs, so people on the site keep the rest", async () => {
    const d = deps({ env: { MCP_LIVE_RUNS_DAILY_SHARE: "2" } });
    const tokens = await Promise.all([0, 1, 2].map(() => storeToken(d.store())));
    const results = [];
    for (const [i, t] of tokens.entries()) results.push(await rpc(d, { token: t.token })("tools/call", { name: "culture_brief", arguments: cultureArgs }, ipN(i)));
    expect(results.map((r) => r.result?.structuredContent?.mode)).toEqual(["live", "live", "example"]);
    expect(results[2].result?.structuredContent).toMatchObject({ reason: "daily-cap" });
    expect(results[2].result?.content?.[0].text).toContain("live runs for MCP agents are used up");
    // The third was refused before intake: nothing spent, nothing of its token's taken.
    expect(d.runIntake).toHaveBeenCalledTimes(2);
    expect(d.startRun).toHaveBeenCalledTimes(2);
    expect(await counter(d.store(), keys.mcp.calls(tokens[2].hash))).toBe(0);
  });

  itRecorded("gives the agents' share back when no new run started: a join or an example replay", async () => {
    const joined = { ...LIVE_START, joined: true } as const;
    const busy = { mode: "example", slug: "food-hot-sauce", reason: "busy", message: "Live runs are busy right now." } as const;
    const d = deps({ env: { MCP_LIVE_RUNS_DAILY_SHARE: "1" }, startRun: vi.fn<StartRun>().mockResolvedValueOnce(joined).mockResolvedValueOnce(busy).mockResolvedValue(LIVE_START) });
    const tokens = await Promise.all([0, 1, 2].map(() => storeToken(d.store())));
    const modes = [];
    for (const [i, t] of tokens.entries()) modes.push((await rpc(d, { token: t.token })("tools/call", { name: "culture_brief", arguments: cultureArgs }, ipN(i))).result?.structuredContent);
    expect(modes.map((m) => m?.mode)).toEqual(["live", "example", "live"]);
    expect(modes[0]).toMatchObject({ joined: true });
    // Only the third started a new run, so the one-run share is spent now.
    const fourth = await storeToken(d.store());
    expect((await rpc(d, { token: fourth.token })("tools/call", { name: "culture_brief", arguments: cultureArgs }, ipN(9))).result?.content?.[0].text).toContain("live runs for MCP agents are used up");
  });

  itRecorded("reserves score_brief's whole Qloo cap from the day's slice before it starts, and gives back what it did not spend", async () => {
    const d = deps();
    const store = d.store();
    const left = 20;
    await hitRate(store, DAILY_RULES.scoreBriefQloo, EVERYONE, Date.now(), DAILY_RULES.scoreBriefQloo.limit - left);
    const client = createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) });
    const original = client.request.bind(client);
    const seen: number[] = [];
    vi.spyOn(client, "request").mockImplementation(async (...args: Parameters<typeof client.request>) => {
      seen.push(await rateUsed(store, DAILY_RULES.scoreBriefQloo, EVERYONE));
      return original(...args);
    });
    const { token } = await storeToken(store);
    const call = rpc({ ...d, qloo: () => client }, { token });
    const [first, second] = await Promise.all([call("tools/call", { name: "score_brief", arguments: scoreArgs }, ipN(1)), call("tools/call", { name: "score_brief", arguments: scoreArgs }, ipN(2))]);
    // While one call scores, all that was left is reserved: the slice reads full, and the call beside it gets nothing.
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([DAILY_RULES.scoreBriefQloo.limit]));
    const texts = [first, second].map((r) => r.result?.content?.[0].text ?? "");
    expect(texts.filter((t) => t.includes("scoring budget is used up"))).toHaveLength(1);
    expect([first, second].filter((r) => r.result?.structuredContent?.status === "scored")).toHaveLength(1);
    // Replayed fixtures spend no live calls, so the whole reservation came back.
    expect(await rateUsed(store, DAILY_RULES.scoreBriefQloo, EVERYONE)).toBe(DAILY_RULES.scoreBriefQloo.limit - left);
  });
});
