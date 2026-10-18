// GET /api/render/<jobId>: a server-paid draft's status (queued, rendering, done with its video, or
// failed with a reason). When no poller has touched the job lately, it checks fal itself after answering.
import { connection } from "next/server";
import { createRenderStatusGet } from "@/lib/render/routes";
import { renderRouteDeps } from "@/lib/render/server";

// The status check runs in after(): fal's status, the result and the download (lib/render/routes.ts).
export const maxDuration = 120;

export async function GET(request: Request, ctx: RouteContext<"/api/render/[jobId]">): Promise<Response> {
  await connection();
  const { jobId } = await ctx.params;
  return createRenderStatusGet(renderRouteDeps())(request, jobId);
}
