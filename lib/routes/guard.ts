// The steps every lane C route takes before its own work: the bot check, the store (a missing shared
// store fails closed), the visitor, and the per-visitor rate limit. Handlers get their dependencies
// injected, so tests run them with a MemoryStore and plain Requests.
import type { BotCheck, BotCheckKind } from "../bot-check";
import { apiError, MESSAGES, rateLimited } from "../http";
import { hitRate, type RateRule } from "../rate-limit";
import type { Store } from "../store/types";
import { visitorId, type VisitorId } from "../store/visitor";

export interface GuardDeps {
  store: () => Store;
  botCheck: () => BotCheck;
  now?: () => number;
}

export type Guarded = { ok: true; store: Store; visitor: VisitorId } | { ok: false; response: Response };

export async function guard(request: Request, deps: GuardDeps, rule: RateRule, kind: BotCheckKind = "browser"): Promise<Guarded> {
  // Browser routes serve Stoop's own pages: a request a browser marks as cross-site came from another site.
  if (kind === "browser" && request.headers.get("sec-fetch-site") === "cross-site") return { ok: false, response: apiError("invalid", MESSAGES.crossSite, 403) };
  const verdict = await deps.botCheck().check(request, { kind });
  if (verdict.bot) return { ok: false, response: apiError("bot", MESSAGES.bot, 403) };
  let store: Store;
  try {
    store = deps.store();
  } catch (error) {
    console.error(`No store for ${new URL(request.url).pathname}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, response: apiError("failed", MESSAGES.storeDown, 503) };
  }
  const visitor = await visitorId(store, request.headers);
  const rate = await hitRate(store, rule, visitor, deps.now?.());
  if (!rate.ok) return { ok: false, response: rateLimited(rate.retryAfterSeconds) };
  return { ok: true, store, visitor };
}

/** Runs a handler and turns an unexpected throw into the API's "failed" answer (logged without request data). */
export async function failSafe(name: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    return apiError("failed", MESSAGES.failed, 500);
  }
}
