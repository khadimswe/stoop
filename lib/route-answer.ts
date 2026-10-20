// Small helpers the frames and revise routes share: the JSON body read every route uses (lib/http.ts
// readJson: a JSON content type, capped while it streams), and answers built from the API contract's
// schemas (lib/api/responses.ts), so a route can never send a shape the browser does not expect.
import { apiErrorSchema, type ApiError } from "./api/responses";
import { BodyError, readJson as readHttpJson } from "./http";

export interface RouteAnswer<T> {
  status: number;
  body: T | ApiError;
}

const ERROR_STATUS = { invalid: 400, not_found: 404, rate_limited: 429, daily_cap: 429, busy: 409, off: 503, bot: 403, failed: 500 } as const;

export function apiError(code: ApiError["error"]["code"], message: string, status: number = ERROR_STATUS[code]): RouteAnswer<never> {
  return { status, body: apiErrorSchema.parse({ error: { code, message: message.slice(0, 300) } }) };
}

export type BodyRead = { ok: true; body: unknown } | { ok: false; answer: RouteAnswer<never> };

/**
 * The request's JSON body, read as lib/http.ts readJson reads it: sent as application/json (another
 * site's plain form cannot), and stopped as soon as it passes `maxBytes`, whatever content-length
 * says. Otherwise the answer to send: 415 not JSON, 413 too large, 400 bad JSON.
 */
export async function readJson(request: Request, maxBytes = 4_096): Promise<BodyRead> {
  try {
    return { ok: true, body: await readHttpJson(request, maxBytes) };
  } catch (error) {
    if (error instanceof BodyError) return { ok: false, answer: apiError("invalid", error.message, error.status) };
    throw error;
  }
}

/** Sends an answer as JSON, never cached. */
export function respond<T>(answer: RouteAnswer<T>): Response {
  return Response.json(answer.body, { status: answer.status, headers: { "cache-control": "no-store" } });
}
