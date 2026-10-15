import type { QlooClient, QlooResult } from "./client";
import { ENDPOINTS } from "./constants";
import type { RunContext } from "./context";
import type { TagsParams } from "./schemas";
import { tagsResponse, type QlooTag } from "./types";

/**
 * Finds Qloo tags by text, e.g. turning the founder's stated customer ("foodies") into tag ids.
 * Matching is loose (any word can match, so "independent bookstores" can return the music genre
 * "Independent" first), so callers should check the hit before trusting it.
 */
export function searchTags(
  client: QlooClient,
  ctx: RunContext,
  params: TagsParams,
  meta: { label?: string; stage?: string } = {},
): Promise<QlooResult<QlooTag[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.tags,
    params,
    schema: tagsResponse,
    label: meta.label ?? `Finding Qloo tags for "${params["filter.query"]}"`,
    stage: meta.stage,
  });
}
