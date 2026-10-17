// The runtime bound to its real vendors, for the routes: the shared store, the server's Qloo client,
// Claude, the reference audiences and the shared creative writer. `server-only`: keys never reach a
// browser bundle. Each vendor is built only when a route needs it, so replay mode needs none.
import "server-only";
import { SHARED_CREATIVE } from "../agent/creative";
import { stoopModel, stoopModelId } from "../agent/model";
import { referenceSets } from "../geo/reference";
import { getQlooClient } from "../qloo/server";
import { getStore } from "../store";
import { exampleEvents, exampleReport, exampleSlug } from "./examples";
import { executeRun } from "./execute";
import type { RouteDeps } from "./routes";

export function liveModel() {
  const modelId = stoopModelId();
  return Object.assign(stoopModel(modelId), { modelId });
}

/** The live run, bound to its vendors. Runs inside `after()`. */
export function execute(runId: string): Promise<void> {
  return executeRun({ store: getStore(), client: getQlooClient(), model: liveModel(), reference: referenceSets(), creative: SHARED_CREATIVE }, runId);
}

export const routeDeps = (): RouteDeps => ({
  store: () => getStore(),
  start: () => ({ execute }),
  intake: () => ({ client: getQlooClient(), model: liveModel() }),
  search: () => ({ client: getQlooClient() }),
  examples: { slug: exampleSlug, events: exampleEvents, report: exampleReport },
});
