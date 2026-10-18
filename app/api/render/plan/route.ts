// POST /api/render/plan {target}: the draft's RenderPlan for the /byok page (and the estimate), built on
// the server from the report's own pack, with private references presigned for an hour.
import { createRenderPlanPost } from "@/lib/render/routes";
import { renderRouteDeps } from "@/lib/render/server";

export function POST(request: Request): Promise<Response> {
  return createRenderPlanPost(renderRouteDeps())(request);
}
