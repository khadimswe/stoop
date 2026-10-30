// POST /api/plan/<id>/social/post { pageId, channels, when }: posts a live plan's poster with each
// channel's approved caption to the manager's Page and its Instagram account, now or scheduled. Only on
// the manager's tap, and only from the browser that started the plan (lib/plan/owner.ts: 403 for
// anyone else holding its share link); example plans never post (403); 404 while posting is off.
import { ownerOnly } from "@/lib/plan/owner";
import { postToMeta } from "@/lib/social/routes";
import { failSafe } from "@/lib/routes/guard";
import { socialDeps } from "@/lib/social/server";
import { getStore } from "@/lib/store";

// Instagram's publish checks the container a few times before it goes out.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/plan/[id]/social/post">) {
  const { id } = await ctx.params;
  return failSafe("Meta post", () => ownerOnly(request, id, getStore, () => postToMeta(request, id, socialDeps())));
}
