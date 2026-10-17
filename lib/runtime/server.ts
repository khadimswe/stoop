// The runtime bound to its real vendors, for the routes: the shared store, the server's Qloo client,
// Claude, the reference audiences and the shared creative writer. `server-only`: keys never reach a
// browser bundle.
import "server-only";
import { ZodError } from "zod";
import { SHARED_CREATIVE } from "../agent/creative";
import { stoopModel, stoopModelId } from "../agent/model";
import type { ApiError } from "../api/responses";
import { referenceSets } from "../geo/reference";
import { getQlooClient } from "../qloo/server";
import { getStore } from "../store";
import { visitorId } from "../store/visitor";
import { ApiFailure } from "./errors";
import { executeRun } from "./execute";
import type { StartDeps } from "./start";
import type { RequestContext } from "./types";

export function liveModel() {
  const modelId = stoopModelId();
  return Object.assign(stoopModel(modelId), { modelId });
}

/** The live run, bound to its vendors. Runs inside `after()`. */
export function execute(runId: string): Promise<void> {
  return executeRun({ store: getStore(), client: getQlooClient(), model: liveModel(), reference: referenceSets(), creative: SHARED_CREATIVE }, runId);
}

export const startDeps = (): StartDeps => ({ execute });

export async function requestContext(request: Request, source: RequestContext["source"] = "web"): Promise<RequestContext> {
  const store = getStore();
  return { store, visitor: await visitorId(store, request.headers), source, signal: request.signal };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** A refusal as the API's error shape; anything unexpected is a plain 500 that leaks nothing. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiFailure) return json({ error: { code: error.code, message: error.message } } satisfies ApiError, error.status);
  if (error instanceof ZodError) return json({ error: { code: "invalid", message: error.issues[0]?.message ?? "That request is not valid." } } satisfies ApiError, 400);
  if (error instanceof SyntaxError) return json({ error: { code: "invalid", message: "The request body must be JSON." } } satisfies ApiError, 400);
  console.error(`API error: ${error instanceof Error ? error.name : "unknown"}`);
  return json({ error: { code: "failed", message: "Something went wrong on our side. The examples still work." } } satisfies ApiError, 500);
}
