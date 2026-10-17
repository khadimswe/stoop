// POST /api/frames/<runId> { segmentId }: a world's storyboard frames, as their own invocation. The
// checks answer right away (lib/media/frames.ts requestFrames); the rendering, the critique and the
// re-renders run after the response, and stream to the page as world.frames events.
import { after } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { browserOnly } from "@/lib/routes/guard";
import { stoopModel } from "@/lib/agent/model";
import { isLive } from "@/lib/config";
import { readJson, respond } from "@/lib/route-answer";
import { frameRendererFromEnv, renderWorldFrames, requestFrames } from "@/lib/media/frames";
import { getStorage, StorageConfigError } from "@/lib/storage";
import { getStore } from "@/lib/store";

// Node runtime: the default, and Cache Components refuses the runtime segment option.
export const maxDuration = 300;

/** The job stops itself before the platform's limit, so it can still say it ran out of time. */
const DEADLINE_MS = 280_000;

function storageOrNull() {
  try {
    return getStorage();
  } catch (error) {
    if (error instanceof StorageConfigError) return null;
    throw error;
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/frames/[id]">) {
  const refused = await browserOnly(request, getBotCheck);
  if (refused) return refused;
  const { id } = await ctx.params;
  const body = await readJson(request);
  const renderer = frameRendererFromEnv();
  const storage = storageOrNull();
  const answer = await requestFrames(
    {
      live: isLive(),
      store: getStore,
      headers: request.headers,
      configured: renderer !== null && storage !== null,
      schedule: (task) =>
        after(() =>
          task().catch((error: unknown) => {
            console.error(`Storyboard frames job failed: ${error instanceof Error ? error.name : "error"}`);
          }),
        ),
      job: (job) => renderWorldFrames({ store: getStore(), storage, renderer, model: stoopModel(), abortSignal: AbortSignal.timeout(DEADLINE_MS) }, job),
    },
    id,
    body,
  );
  return respond(answer);
}
