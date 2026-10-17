// POST /api/run: starts (or joins) a live run from /start's confirmed inputs, or answers with an
// example replay and why. The run itself goes on in `after()`, within this function's max duration.
import { runStartRequestSchema } from "@/lib/api/requests";
import { errorResponse, json, requestContext, startDeps } from "@/lib/runtime/server";
import { startRun } from "@/lib/runtime/start";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const input = runStartRequestSchema.parse(await request.json());
    return json(await startRun(startDeps(), input, await requestContext(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
