// GET /api/plan/<id>/marketing/poster.png: the composited event poster, 1080 by 1350 for Instagram
// portrait, or 1200 by 630 with ?size=og for link previews (the /e/<id> page's og:image); ?variant=b
// draws an A/B test's variant B (404 when the plan tests no second concept). Every word is
// set by code; the background is the plan's rendered art when it is on Stoop's own storage, else the
// plain Stoop background. Examples (ex-<slug>) read their recorded plan, so they draw without a store.
// ?size=thumb (360 wide) and ?size=medium (720 wide) answer the portrait poster as a small WebP, for
// lists and the public event page, so a phone never downloads the full PNG to show a thumbnail.
import { connection } from "next/server";
import sharp from "sharp";
import { isLive } from "@/lib/config";
import { metadataOrigin } from "@/lib/marketing/site";
import { posterResponse } from "@/lib/plan/posts-run";
import { storePlanSource } from "@/lib/plan/posts-store";
import { getStore } from "@/lib/store";

const SMALL: Record<string, number> = { thumb: 360, medium: 720 };

export async function GET(request: Request, ctx: RouteContext<"/api/plan/[id]/marketing/poster.png">) {
  await connection();
  const { id } = await ctx.params;
  const query = new URL(request.url).searchParams;
  const asked = query.get("size") ?? "";
  const size = asked === "og" ? "og" : "portrait";
  const variant = query.get("variant") === "b" ? "b" : "a";
  const site = metadataOrigin({ app: process.env.NEXT_PUBLIC_APP_URL, production: process.env.VERCEL_PROJECT_PRODUCTION_URL, deployment: process.env.VERCEL_URL }).origin;
  const r2 = process.env.R2_PUBLIC_URL?.trim();
  const response = await posterResponse(
    {
      live: isLive(),
      store: getStore,
      // Examples read their recording, so they work where no store is configured.
      source: (store) => storePlanSource(store),
      artOrigins: [site, ...(r2 ? [r2] : [])],
    },
    id,
    size,
    variant,
  );
  const width = SMALL[asked];
  if (!width || !response.ok || !response.headers.get("content-type")?.startsWith("image/")) return response;
  const small = await sharp(Buffer.from(await response.arrayBuffer()))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return new Response(new Uint8Array(small), {
    headers: { "content-type": "image/webp", "cache-control": response.headers.get("cache-control") ?? "no-store" },
  });
}
