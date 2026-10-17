// The draft video routes' real dependencies: the process env, the store, the shipped examples and their
// approved demo media, both storages, fal with FAL_KEY, and after() for the poller. Server only.
import "server-only";
import { after } from "next/server";
import { getBotCheck } from "../bot-check";
import { approvalsSchema, demoMediaFor, manifestSchema } from "../demo/manifest";
import { exampleReport, exampleSlug } from "../runtime/examples";
import { getPrivateStorage, getStorage, StorageConfigError, type PrivateStorage, type Storage } from "../storage";
import { getStore } from "../store";
import { loadReport } from "../store/runs";
import approvals from "../../public/demo/approvals.json";
import manifest from "../../public/demo/manifest.json";
import { videoQueueFromEnv, type VideoQueue } from "./fal";
import type { RenderRouteDeps } from "./routes";

const demo = { manifest: manifestSchema.parse(manifest), approvals: approvalsSchema.parse(approvals) };

function orNull<T>(make: () => T): T | null {
  try {
    return make();
  } catch (error) {
    if (error instanceof StorageConfigError) return null;
    throw error;
  }
}

let queue: VideoQueue | null | undefined;

export function renderRouteDeps(): RenderRouteDeps {
  return {
    env: process.env,
    store: getStore,
    botCheck: getBotCheck,
    loadReport: async (reportId, store) => {
      const slug = exampleSlug(reportId);
      return slug ? exampleReport(slug) : loadReport(store, reportId);
    },
    demoMedia: (slug) => demoMediaFor(demo.manifest, demo.approvals, slug),
    privateStorage: (): PrivateStorage | null => orNull(() => getPrivateStorage()),
    storage: (): Storage | null => orNull(() => getStorage()),
    queue: () => (queue === undefined ? (queue = videoQueueFromEnv()) : queue),
    schedule: (task) => after(task),
  };
}
