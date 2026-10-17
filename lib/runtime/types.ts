// The runtime's entry points, as the web routes and the MCP endpoint both call them. The runtime
// implements them; MCP's culture_brief calls the same two, so it gets the same caps, admission and
// guardrails as the web flow.
import type { IntakeRequest, RunStartRequest } from "../api/requests";
import type { IntakeResponse, RunStartResponse } from "../api/responses";
import type { Store } from "../store/types";
import type { VisitorId } from "../store/visitor";

export interface RequestContext {
  store: Store;
  visitor: VisitorId;
  /** Which door the request came through, for the per-IP limits and the trace. */
  source: "web" | "mcp";
  /** Aborted when the caller goes away. */
  signal?: AbortSignal;
  /**
   * When the invocation began, set when work before the run (MCP's intake) shares its time limit:
   * the run's deadline then counts from here, not from its own start.
   */
  startedAt?: number;
}

/** Reads the page, Claude's site reading and the proposed seeds, and stores the intake for /start. */
export type RunIntake = (input: IntakeRequest, ctx: RequestContext) => Promise<IntakeResponse>;

/** Starts (or joins) a live run, or answers with an example replay and why. */
export type StartRun = (input: RunStartRequest, ctx: RequestContext) => Promise<RunStartResponse>;
