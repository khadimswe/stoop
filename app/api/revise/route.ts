// POST /api/revise { runId, segmentId, field, exclude, reason }: "Not this vibe" on one cue or a
// whole world of a finished live run. The checks and limits answer right away (lib/stages/revise.ts
// requestRevision); the revision runs after the response and streams to the page as world.revised.
import { after } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { browserOnly } from "@/lib/routes/guard";
import { SHARED_CREATIVE } from "@/lib/agent/creative";
import { stoopModel, stoopModelId } from "@/lib/agent/model";
import { isLive } from "@/lib/config";
import { referenceSets } from "@/lib/geo/reference";
import { readJson, respond } from "@/lib/route-answer";
import { getQlooClient } from "@/lib/qloo/server";
import { requestRevision, runRevision } from "@/lib/stages/revise";
import { getStore } from "@/lib/store";

// Node runtime: the default, and Cache Components refuses the runtime segment option.
export const maxDuration = 300;

/** The job stops itself before the platform's limit, so it can still say it ran out of time. */
const DEADLINE_MS = 280_000;

export async function POST(request: Request) {
  const refused = await browserOnly(request, getBotCheck);
  if (refused) return refused;
  const body = await readJson(request);
  const answer = await requestRevision({
    live: isLive(),
    store: getStore,
    headers: request.headers,
    schedule: (task) =>
      after(() =>
        task().catch((error: unknown) => {
          console.error(`Revision job failed: ${error instanceof Error ? error.name : "error"}`);
        }),
      ),
    job: (job) => {
      const modelId = stoopModelId();
      return runRevision(
        {
          store: getStore(),
          client: getQlooClient(),
          model: stoopModel(modelId),
          modelId,
          creative: SHARED_CREATIVE,
          reference: referenceSets(),
          // Live runs measure new audiences, never one of the frozen reference audiences.
          inReference: false,
          abortSignal: AbortSignal.timeout(DEADLINE_MS),
        },
        job,
      );
    },
  }, body);
  return respond(answer);
}
