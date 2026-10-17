// The steps every lane C route takes before its own work: the bot check, the store (a missing shared
// store fails closed), the visitor, and the per-visitor rate limit. Handlers get their dependencies
// injected, so tests run them with a MemoryStore and plain Requests. Every log line passes through
// redactTokens: /api/mcp/<token> puts an MCP token in the path, and an error message may quote one.
import type { BotCheck, BotCheckKind } from "../bot-check";
import { apiError, MESSAGES, rateLimited } from "../http";
import { redactTokens } from "../mcp/token";
import { hitRate, type RateRule } from "../rate-limit";
import type { Store } from "../store/types";
import { visitorId, type VisitorId } from "../store/visitor";

export interface GuardDeps {
  store: () => Store;
  botCheck: () => BotCheck;
  now?: () => number;
}

export type Guarded = { ok: true; store: Store; visitor: VisitorId } | { ok: false; response: Response };

/**
 * The request's path, decoded first so a percent-encoded token is redacted too (Next decodes the
 * segment before it is used). A path that does not decode is logged as its route family only.
 */
export function loggablePath(request: Request): string {
  const path = new URL(request.url).pathname;
  try {
    return redactTokens(decodeURIComponent(path));
  } catch {
    return path.startsWith("/api/mcp/") ? "/api/mcp/[token]" : "[undecodable path]";
  }
}

export async function guard(request: Request, deps: GuardDeps, rule: RateRule, kind: BotCheckKind = "browser"): Promise<Guarded> {
  // Browser routes serve Stoop's own pages: a request a browser marks as cross-site came from another site.
  if (kind === "browser" && request.headers.get("sec-fetch-site") === "cross-site") return { ok: false, response: apiError("invalid", MESSAGES.crossSite, 403) };
  const verdict = await deps.botCheck().check(request, { kind });
  if (verdict.bot) return { ok: false, response: apiError("bot", MESSAGES.bot, 403) };
  let store: Store;
  try {
    store = deps.store();
  } catch (error) {
    console.error(redactTokens(`No store for ${loggablePath(request)}: ${error instanceof Error ? error.message : String(error)}`));
    return { ok: false, response: apiError("failed", MESSAGES.storeDown, 503) };
  }
  const visitor = await visitorId(store, request.headers);
  const rate = await hitRate(store, rule, visitor, deps.now?.());
  if (!rate.ok) return { ok: false, response: rateLimited(rate.retryAfterSeconds) };
  return { ok: true, store, visitor };
}

/**
 * The first checks of any browser route that spends (runs, intake, frames, revise): another site's
 * request (Sec-Fetch-Site: cross-site) and what the bot check flags are refused. Null lets it through.
 */
export async function browserOnly(request: Request, botCheck: () => BotCheck): Promise<Response | null> {
  if (request.headers.get("sec-fetch-site") === "cross-site") return apiError("invalid", MESSAGES.crossSite, 403);
  if ((await botCheck().check(request, { kind: "browser" })).bot) return apiError("bot", MESSAGES.bot, 403);
  return null;
}

/** Runs a handler and turns an unexpected throw into the API's "failed" answer (logged without request data). */
export async function failSafe(name: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error(redactTokens(`${name} failed: ${error instanceof Error ? error.message : String(error)}`));
    return apiError("failed", MESSAGES.failed, 500);
  }
}
