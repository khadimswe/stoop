// GET /api/plan/<id>/social/poster.jpg: the plan's poster as a JPEG, for Instagram's servers to fetch
// (Instagram takes JPEG only, from a public URL). Live plans only; 404 while posting is off.
import { connection } from "next/server";
import { posterJpeg } from "@/lib/social/routes";
import { socialDeps } from "@/lib/social/server";

export async function GET(_request: Request, ctx: RouteContext<"/api/plan/[id]/social/poster.jpg">) {
  await connection();
  const { id } = await ctx.params;
  return posterJpeg(id, socialDeps());
}
