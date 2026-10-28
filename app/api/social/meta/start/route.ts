// GET /api/social/meta/start?return=<path>: redirects to Facebook's login dialog with a signed state,
// so the manager can connect their Page. 404 unless ENABLE_META_POSTING and the Meta app keys are set.
import { connection } from "next/server";
import { startConnect } from "@/lib/social/routes";
import { failSafe } from "@/lib/routes/guard";
import { socialDeps } from "@/lib/social/server";

export async function GET(request: Request) {
  await connection();
  return failSafe("Meta connect start", () => startConnect(request, socialDeps()));
}
