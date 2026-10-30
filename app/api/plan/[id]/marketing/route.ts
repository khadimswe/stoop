// POST /api/plan/<id>/marketing: a finished live plan's poster and posts, as their own invocation. The
// plan starts them itself as soon as it finishes (lib/plan/server.ts); the page asks here only when that
// could not happen, and a second ask never makes a second set (the job's lock). With { "remake": "art" }
// it paints a new version of the poster's background. The checks answer right away (lib/plan/posts-run.ts
// requestMarketing); the posts (Claude) and the poster art (fal) are written after the response and
// stream to the plan as poster.updated and posts.ready events. The art counts against the asker's
// storyboards for the day and the global frame cap.
// Only the browser that started the plan may ask (lib/plan/owner.ts); the server's own job never comes here.
import { after, connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { isLive } from "@/lib/config";
import { cookieVisitorOf } from "@/lib/http";
import { marketingJob, remakeJob } from "@/lib/plan/marketing-server";
import { checkPlanOwner, ownerRefusal, publicMarketingState } from "@/lib/plan/owner";
import { marketingRequestSchema, marketingState, marketingStateSchema, requestMarketing } from "@/lib/plan/posts-run";
import { isLivePlanId, storePlanSource } from "@/lib/plan/posts-store";
import { apiError, readJson, respond } from "@/lib/route-answer";
import { browserOnly } from "@/lib/routes/guard";
import { signingSecret } from "@/lib/sign";
import { getStore } from "@/lib/store";

/** The job stops itself before the platform's limit. */
const DEADLINE_MS = 280_000;

export async function POST(request: Request, ctx: RouteContext<"/api/plan/[id]/marketing">) {
  const refused = await browserOnly(request, getBotCheck);
  if (refused) return refused;
  const { id } = await ctx.params;
  const notOwner = await ownerRefusal(request, id, getStore);
  if (notOwner) return notOwner;
  // An empty body (or none) makes the poster and posts; { "remake": "art" } asks for a new version.
  const read = request.headers.get("content-length") === "0" || !request.body ? { ok: true as const, body: {} } : await readJson(request, 256);
  if (!read.ok) return respond(read.answer);
  const body = marketingRequestSchema.safeParse(read.body ?? {});
  if (!body.success) return respond(apiError("invalid", "That request is not valid."));
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
      job: (store, source, runId, visitor) => marketingJob(store, source, runId, visitor, DEADLINE_MS),
      remake: (store, source, runId, visitor, version) => remakeJob(store, source, runId, visitor, version, DEADLINE_MS),
    },
    id,
    body.data,
  );
  return respond(answer);
}

// GET /api/plan/<id>/marketing: both variants' posters and posts ({ a, b }), b only when the plan's A/B
// test runs a second concept. Variant A is also in the plan's own events (poster, posts). For a live
// plan, the drafts go only to its owner: anyone else gets the posters alone (posts null).
export async function GET(request: Request, ctx: RouteContext<"/api/plan/[id]/marketing">) {
  await connection();
  const { id } = await ctx.params;
  const response = await marketingState({ live: isLive(), store: getStore, source: (store) => storePlanSource(store), artOrigins: [] }, id);
  // Examples (which need no store) are public as they are.
  if (!response.ok || !isLivePlanId(id)) return response;
  const check = await Promise.resolve()
    .then(() => checkPlanOwner(request, id, getStore()))
    .catch(() => null);
  if (check?.kind === "owner") return response;
  return Response.json(publicMarketingState(marketingStateSchema.parse(await response.json())), { headers: { "cache-control": "no-store" } });
}
