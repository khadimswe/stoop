// POST /api/run/[id]/resume: the Resume button. The next attempt replays what the stopped one already
// measured and wrote (from the shared caches) and goes on live from there.
import { liveRunIdSchema } from "@/lib/api/requests";
import { errorResponse, json, requestContext, startDeps } from "@/lib/runtime/server";
import { resumeRun } from "@/lib/runtime/start";

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const runId = liveRunIdSchema.parse((await params).id);
    return json(await resumeRun(startDeps(), runId, await requestContext(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
