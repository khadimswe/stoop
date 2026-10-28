// POST /api/plan/<id>/marketing: a finished live plan's poster and posts, as their own invocation. The
// checks answer right away (lib/plan/posts-run.ts requestMarketing); the posts (Claude) and the poster
// art (fal) are written after the response and stream to the plan as poster.updated and posts.ready
// events. The art counts against the asker's storyboards for the day and the global frame cap.
import { after } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { stoopModel } from "@/lib/agent/model";
import { isLive } from "@/lib/config";
import { cookieVisitorOf } from "@/lib/http";
import { metadataOrigin } from "@/lib/marketing/site";
import { posterRendererFromEnv } from "@/lib/plan/poster-art";
import { requestMarketing, runMarketing } from "@/lib/plan/posts-run";
import { storePlanSource } from "@/lib/plan/posts-store";
import { respond } from "@/lib/route-answer";
import { browserOnly } from "@/lib/routes/guard";
import { signingSecret } from "@/lib/sign";
import { getStorage, StorageConfigError } from "@/lib/storage";
import { getStore } from "@/lib/store";

// Node runtime: the default, and Cache Components refuses the runtime segment option.
export const maxDuration = 300;

/** The job stops itself before the platform's limit. */
const DEADLINE_MS = 280_000;

function storageOrNull() {
  try {
    return getStorage();
  } catch (error) {
    if (error instanceof StorageConfigError) return null;
    throw error;
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/plan/[id]/marketing">) {
  const refused = await browserOnly(request, getBotCheck);
  if (refused) return refused;
  const { id } = await ctx.params;
  const origin = metadataOrigin({ app: process.env.NEXT_PUBLIC_APP_URL, production: process.env.VERCEL_PROJECT_PRODUCTION_URL, deployment: process.env.VERCEL_URL }).origin;
  const answer = await requestMarketing(
    {
      live: isLive(),
      store: getStore,
      source: (store) => storePlanSource(store),
      headers: request.headers,
      cookieVisitor: cookieVisitorOf(request, signingSecret()),
      schedule: (task) =>
        after(() =>
          task().catch((error: unknown) => {
            console.error(`Marketing job failed: ${error instanceof Error ? error.name : "error"}`);
          }),
        ),
      job: (store, source, runId, visitor) =>
        runMarketing({ store, source, model: stoopModel(), art: { storage: storageOrNull(), renderer: posterRendererFromEnv() }, origin, abortSignal: AbortSignal.timeout(DEADLINE_MS) }, runId, visitor),
    },
    id,
  );
  return respond(answer);
}
