// POST /api/run: starts (or joins) a live run from /start's confirmed inputs, or answers with an
// example replay and why. The run itself goes on in `after()`, within this function's max duration.
import { postRun } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export function POST(request: Request) {
  return postRun(request, routeDeps());
}
