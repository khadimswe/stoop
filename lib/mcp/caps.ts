// What MCP tool calls may spend per UTC day (lib/config.ts mcpCaps): per token, 40 tool calls of which
// 3 culture_briefs, and MCP_DAILY_CAP tool calls across every token. A call takes its units right
// before it spends anything (atomic counters, so concurrent calls never pass a cap together), and keeps
// them once spending started: a culture_brief once intake was called (whatever it or StartRun did next),
// a score_brief once it made a live Qloo call. Units come back only when a call was refused before
// spending, or did no work (a culture_brief whose runtime is not wired, a score_brief that failed before
// any live call). culture_brief also takes from the agents' daily share of live runs right before
// StartRun (MCP_LIVE_RUNS_DAILY_SHARE), and StartRun counts it against LIVE_RUNS_DAILY_CAP too.
import type { McpCaps } from "../config";
import { EVERYONE, reserveEach, ruleCounter, type Capped, type Reserved } from "../rate-limit";
import { DAY_SECONDS, dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";

export type McpTool = "score_brief" | "culture_brief" | "plan_store_event";
export type McpCapName = "token-culture-briefs" | "token-calls" | "daily-calls";

/** The counters one call takes from, narrowest first: the token's own limits before the shared one. */
export function callCounters(tokenHash: string, tool: McpTool, caps: McpCaps, now: number = Date.now()): Capped<McpCapName>[] {
  const day = dayOf(now);
  return [
    // A store-event plan starts a live run too, so it shares the token's daily brief limit.
    ...(tool !== "score_brief" ? [{ name: "token-culture-briefs" as const, key: keys.mcp.cultureBriefs(tokenHash, day), cap: caps.perToken.cultureBriefs, ttlSeconds: TTL.daily }] : []),
    { name: "token-calls", key: keys.mcp.calls(tokenHash, day), cap: caps.perToken.calls, ttlSeconds: TTL.daily },
    { name: "daily-calls", key: keys.daily("mcp-calls", day), cap: caps.daily, ttlSeconds: TTL.daily },
  ];
}

/** Takes one call (and, for culture_brief, one brief) from the token's day and the shared day. */
export function reserveCall(store: Store, tokenHash: string, tool: McpTool, caps: McpCaps, now: number = Date.now()): Promise<Reserved<McpCapName>> {
  return reserveEach(store, callCounters(tokenHash, tool, caps, now));
}

/** The day's counter of live runs culture_brief started, across every token (a global budget on the EVERYONE key). */
export function liveRunShareCounter(caps: McpCaps, now: number = Date.now()): Capped<"mcp-live-runs"> {
  const { key, ttlSeconds } = ruleCounter({ name: "daily-mcp-live-runs", limit: caps.liveRunsShare, windowSeconds: DAY_SECONDS }, EVERYONE, now);
  return { name: "mcp-live-runs", key, cap: caps.liveRunsShare, ttlSeconds };
}

/** What a tool answers when a cap is spent. */
export function capRefusal(name: McpCapName, caps: McpCaps): string {
  switch (name) {
    case "token-culture-briefs":
      return `This token has used its ${caps.perToken.cultureBriefs} culture briefs for today. More open at midnight UTC; runs already started keep going at their report links.`;
    case "token-calls":
      return `This token has made its ${caps.perToken.calls} tool calls for today. They reset at midnight UTC.`;
    case "daily-calls":
      return "Stoop's MCP tools have reached today's limit across all agents. They open again at midnight UTC.";
  }
}
