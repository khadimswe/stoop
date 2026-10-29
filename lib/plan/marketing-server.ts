// The marketing job bound to its real vendors: Claude for the posts, fal and Stoop's storage for the
// art, the site's origin for the share links. The marketing route (app/api/plan/[id]/marketing) and the
// automatic start after a live plan (lib/plan/server.ts) both run it from here. `server-only`: keys
// never reach a browser bundle.
import "server-only";
import { stoopModel } from "../agent/model";
import { metadataOrigin } from "../marketing/site";
import { getStorage, StorageConfigError } from "../storage";
import type { Store } from "../store/types";
import type { StoryboardVisitor } from "../media/storyboards";
import { posterRendererFromEnv } from "./poster-art";
import { runMarketing, runRemake, type MarketingEnv } from "./posts-run";
import type { PlanSource } from "./posts-store";

function storageOrNull() {
  try {
    return getStorage();
  } catch (error) {
    if (error instanceof StorageConfigError) return null;
    throw error;
  }
}

export function siteOrigin(): string {
  return metadataOrigin({ app: process.env.NEXT_PUBLIC_APP_URL, production: process.env.VERCEL_PROJECT_PRODUCTION_URL, deployment: process.env.VERCEL_URL }).origin;
}

function marketingEnv(store: Store, source: PlanSource, deadlineMs: number): MarketingEnv {
  return { store, source, model: stoopModel(), art: { storage: storageOrNull(), renderer: posterRendererFromEnv() }, origin: siteOrigin(), abortSignal: AbortSignal.timeout(deadlineMs) };
}

/** The poster and posts for one plan, stopped by `deadlineMs`. */
export const marketingJob = (store: Store, source: PlanSource, runId: string, visitor: StoryboardVisitor | null, deadlineMs: number) => runMarketing(marketingEnv(store, source, deadlineMs), runId, visitor);

/** A new version of the poster's art, stopped by `deadlineMs`. */
export const remakeJob = (store: Store, source: PlanSource, runId: string, visitor: StoryboardVisitor, version: number, deadlineMs: number) => runRemake(marketingEnv(store, source, deadlineMs), runId, visitor, version);
