// The social routes bound to their real vendors: the env flags and keys, the shared store, the plan
// store, Meta over plain fetch, the poster drawn in process (the same code as
// /api/plan/[id]/marketing/poster.png) and sharp for Instagram's JPEG. `server-only`: the app secret
// and the tokens never reach a browser bundle.
import "server-only";
import sharp from "sharp";
import { getBotCheck } from "../bot-check";
import { isLive, judgingEndsAt, metaPostingEnabled } from "../config";
import { metadataOrigin } from "../marketing/site";
import { posterResponse } from "../plan/posts-run";
import { storePlanSource } from "../plan/posts-store";
import { signingSecret } from "../sign";
import { getStore } from "../store";
import { metaApp } from "./meta";
import type { SocialDeps } from "./routes";

/** The composited poster PNG, from the same code as the public poster route. */
async function posterPng(planId: string): Promise<Uint8Array | null> {
  const site = metadataOrigin({ app: process.env.NEXT_PUBLIC_APP_URL, production: process.env.VERCEL_PROJECT_PRODUCTION_URL, deployment: process.env.VERCEL_URL }).origin;
  const r2 = process.env.R2_PUBLIC_URL?.trim();
  const response = await posterResponse({ live: isLive(), store: getStore, source: (store) => storePlanSource(store), artOrigins: [site, ...(r2 ? [r2] : [])] }, planId, "portrait");
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png") return null;
  return new Uint8Array(await response.arrayBuffer());
}

async function toJpeg(png: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}

export function socialDeps(): SocialDeps {
  return {
    enabled: metaPostingEnabled(),
    app: metaApp(),
    secret: signingSecret(),
    until: judgingEndsAt(),
    store: getStore,
    source: (store) => storePlanSource(store),
    fetch: (input, init) => fetch(input, init),
    poster: posterPng,
    toJpeg,
    botCheck: getBotCheck,
  };
}
