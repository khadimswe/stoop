// GET /api/plan/<id>/marketing/poster.png: the composited event poster, 1080 by 1350 for Instagram
// portrait, or 1200 by 630 with ?size=og for link previews (the /e/<id> page's og:image). Every word is
// set by code; the background is the plan's rendered art when it is on Stoop's own storage, else the
// plain Stoop background. Examples (ex-<slug>) read their recorded plan, so they draw without a store.
import { connection } from "next/server";
import { isLive } from "@/lib/config";
import { metadataOrigin } from "@/lib/marketing/site";
import { posterResponse } from "@/lib/plan/posts-run";
import { storePlanSource } from "@/lib/plan/posts-store";
import { getStore } from "@/lib/store";

export async function GET(request: Request, ctx: RouteContext<"/api/plan/[id]/marketing/poster.png">) {
  await connection();
  const { id } = await ctx.params;
  const size = new URL(request.url).searchParams.get("size") === "og" ? "og" : "portrait";
  const site = metadataOrigin({ app: process.env.NEXT_PUBLIC_APP_URL, production: process.env.VERCEL_PROJECT_PRODUCTION_URL, deployment: process.env.VERCEL_URL }).origin;
  const r2 = process.env.R2_PUBLIC_URL?.trim();
  return posterResponse(
    {
      live: isLive(),
      store: getStore,
      // Examples read their recording, so they work where no store is configured.
      source: (store) => storePlanSource(store),
      artOrigins: [site, ...(r2 ? [r2] : [])],
    },
    id,
    size,
  );
}
