// How the runtime's routes answer: JSON with no caching, the API's error shape for refusals, and the
// request's context (the store and the visitor's salted id). Pure, so route handlers are tested
// against a MemoryStore.
import { ZodError } from "zod";
import type { ApiError } from "../api/responses";
import { QlooBudgetError } from "../qloo/errors";
import type { Store } from "../store/types";
import { UpstashError } from "../store/upstash";
import { visitorId } from "../store/visitor";
import { ApiFailure } from "./errors";
import type { RequestContext } from "./types";

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const failure = (code: ApiError["error"]["code"], message: string, status: number) => json({ error: { code, message } } satisfies ApiError, status);

/** A refusal as the API's error shape; anything unexpected is a plain 500 that leaks nothing. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiFailure) return failure(error.code, error.message, error.status);
  if (error instanceof ZodError) return failure("invalid", error.issues[0]?.message ?? "That request is not valid.", 400);
  if (error instanceof SyntaxError) return failure("invalid", "The request body must be JSON.", 400);
  if (error instanceof QlooBudgetError) return failure("daily_cap", "Today's live Qloo calls are used up. The examples still show a full run.", 503);
  if (error instanceof UpstashError) return failure("failed", "Stoop's records are not answering right now. The examples still work.", 503);
  console.error(`API error: ${error instanceof Error ? error.name : "unknown"}`);
  return failure("failed", "Something went wrong on our side. The examples still work.", 500);
}

export async function contextFor(request: Request, store: Store, source: RequestContext["source"] = "web"): Promise<RequestContext> {
  return { store, visitor: await visitorId(store, request.headers), source, signal: request.signal };
}
