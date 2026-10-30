// POST /api/render {target}: a draft video paid by Stoop, for judges only (a judge pass, ENABLE_LIVE_VIDEO,
// STOOP_LIVE, FAL_KEY and every render cap). The plan is built on the server from the report's own pack;
// the job finishes after the response and on status polls. Details in lib/render/routes.ts and jobs.ts.
import { createRenderPost } from "@/lib/render/routes";
import { renderRouteDeps } from "@/lib/render/server";

export function POST(request: Request): Promise<Response> {
  return createRenderPost(renderRouteDeps())(request);
}
