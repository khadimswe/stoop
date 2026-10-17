// The runtime bound to its real vendors, for the routes: the shared store, the server's Qloo client,
// Claude, the reference audiences and the shared creative writer. `server-only`: keys never reach a
// browser bundle. Each vendor is built only when a route needs it, so replay mode needs none.
import "server-only";
import { SHARED_CREATIVE } from "../agent/creative";
import { stoopModel, stoopModelId } from "../agent/model";
import { referenceSets } from "../geo/reference";
import { frameRendererFromEnv, renderWorldFrames } from "../media/frames";
import { getQlooClient } from "../qloo/server";
import { getStorage, StorageConfigError, type Storage } from "../storage";
import { getStore } from "../store";
import { exampleEvents, exampleReport, exampleSlug } from "./examples";
import { executeRun, type ExecuteDeps } from "./execute";
import type { RouteDeps } from "./routes";

export function liveModel() {
  const modelId = stoopModelId();
  return Object.assign(stoopModel(modelId), { modelId });
}

function storageOrNull(): Storage | null {
  try {
    return getStorage();
  } catch (error) {
    if (error instanceof StorageConfigError) return null;
    throw error;
  }
}

/** The live run, bound to its vendors. Runs inside `after()`. Frames start only with a frame service and storage set up. */
export function execute(runId: string): Promise<void> {
  const store = getStore();
  const renderer = frameRendererFromEnv();
  const storage = renderer ? storageOrNull() : null;
  const frames: ExecuteDeps["frames"] = renderer && storage ? (job, model, abortSignal) => renderWorldFrames({ store, storage, renderer, model, abortSignal }, job) : undefined;
  return executeRun({ store, client: getQlooClient(), model: liveModel(), reference: referenceSets(), creative: SHARED_CREATIVE, ...(frames ? { frames } : {}) }, runId);
}

export const routeDeps = (): RouteDeps => ({
  store: () => getStore(),
  start: () => ({ execute }),
  intake: () => ({ client: getQlooClient(), model: liveModel() }),
  search: () => ({ client: getQlooClient() }),
  examples: { slug: exampleSlug, events: exampleEvents, report: exampleReport },
});
