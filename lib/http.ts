// Small helpers the frames and revise routes share: a size-capped JSON body read, and answers built
// from the API contract's schemas (lib/api/responses.ts), so a route can never send a shape the
// browser does not expect.
import { apiErrorSchema, type ApiError } from "./api/responses";

export interface RouteAnswer<T> {
  status: number;
  body: T | ApiError;
}

const ERROR_STATUS = { invalid: 400, not_found: 404, rate_limited: 429, daily_cap: 429, busy: 409, off: 503, bot: 403, failed: 500 } as const;

export function apiError(code: ApiError["error"]["code"], message: string, status: number = ERROR_STATUS[code]): RouteAnswer<never> {
  return { status, body: apiErrorSchema.parse({ error: { code, message: message.slice(0, 300) } }) };
}

/** The request's JSON body, or undefined when it is empty, too large or not JSON (the schema check then refuses it). */
export async function readJson(request: Request, maxBytes = 4_096): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return undefined;
  const text = await request.text();
  if (!text || new TextEncoder().encode(text).byteLength > maxBytes) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sends an answer as JSON, never cached. */
export function respond<T>(answer: RouteAnswer<T>): Response {
  return Response.json(answer.body, { status: answer.status, headers: { "cache-control": "no-store" } });
}
