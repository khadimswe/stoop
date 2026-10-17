// What MCP tool calls may spend per UTC day (lib/config.ts mcpCaps): per token, 40 tool calls of which
// 3 culture_briefs, and MCP_DAILY_CAP tool calls across every token. A call takes its units right
// before it spends anything (atomic counters, so concurrent calls never pass a cap together). It keeps
// them once that spending happened (a culture_brief once intake ran, whatever StartRun then answered),
// and gives them back when it was refused before spending, or failed. culture_brief also counts against
// LIVE_RUNS_DAILY_CAP inside StartRun.
import type { McpCaps } from "../config";
import { reserveEach, type Capped, type Reserved } from "../rate-limit";
import { dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";

export type McpTool = "score_brief" | "culture_brief";
export type McpCapName = "token-culture-briefs" | "token-calls" | "daily-calls";

/** The counters one call takes from, narrowest first: the token's own limits before the shared one. */
export function callCounters(tokenHash: string, tool: McpTool, caps: McpCaps, now: number = Date.now()): Capped<McpCapName>[] {
  const day = dayOf(now);
  return [
    ...(tool === "culture_brief" ? [{ name: "token-culture-briefs" as const, key: keys.mcp.cultureBriefs(tokenHash, day), cap: caps.perToken.cultureBriefs, ttlSeconds: TTL.daily }] : []),
    { name: "token-calls", key: keys.mcp.calls(tokenHash, day), cap: caps.perToken.calls, ttlSeconds: TTL.daily },
    { name: "daily-calls", key: keys.daily("mcp-calls", day), cap: caps.daily, ttlSeconds: TTL.daily },
  ];
}

/** Takes one call (and, for culture_brief, one brief) from the token's day and the shared day. */
export function reserveCall(store: Store, tokenHash: string, tool: McpTool, caps: McpCaps, now: number = Date.now()): Promise<Reserved<McpCapName>> {
  return reserveEach(store, callCounters(tokenHash, tool, caps, now));
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
