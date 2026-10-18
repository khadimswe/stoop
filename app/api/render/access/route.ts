// GET /api/render/access?reportId=&segment=: which video line this visitor's report shows (judge,
// byok, budget-used or off) and how many drafts their judge pass has left.
import { connection } from "next/server";
import { createRenderAccessGet } from "@/lib/render/routes";
import { renderRouteDeps } from "@/lib/render/server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return createRenderAccessGet(renderRouteDeps())(request);
}
