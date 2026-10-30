// POST /api/plan: starts (or joins) a live store-event plan from /start's inputs, or answers with an
// example plan and why. The plan itself goes on in `after()`, within this function's max duration.
import { postPlan } from "@/lib/plan/routes";
import { planRouteDeps } from "@/lib/plan/server";

export function POST(request: Request) {
  return postPlan(request, planRouteDeps());
}
