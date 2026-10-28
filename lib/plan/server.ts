// The plan runtime bound to its real vendors, for the routes: the shared store, the server's Qloo
// client and Claude. `server-only`: keys never reach a browser bundle. Each vendor is built only when a
// route needs it, so replay mode (STOOP_LIVE off) needs none.
import "server-only";
import { getBotCheck } from "../bot-check";
import { getQlooClient } from "../qloo/server";
import { liveModel } from "../runtime/server";
import { getStore } from "../store";
import type { PlanRouteDeps } from "./routes";
import { executePlan } from "./runtime";

/** One live plan, bound to its vendors. Runs inside `after()`. */
export function execute(runId: string): Promise<void> {
  return executePlan({ store: getStore(), client: getQlooClient(), model: liveModel() }, runId);
}

export const planRouteDeps = (): PlanRouteDeps => ({
  store: () => getStore(),
  start: () => ({ execute }),
  botCheck: getBotCheck,
});
