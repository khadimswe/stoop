// POST /api/social/meta/disconnect: deletes this browser's stored Meta tokens and clears its cookie.
import { disconnect } from "@/lib/social/routes";
import { failSafe } from "@/lib/routes/guard";
import { socialDeps } from "@/lib/social/server";

export async function POST(request: Request) {
  return failSafe("Meta disconnect", () => disconnect(request, socialDeps()));
}
