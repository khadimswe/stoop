import type { QlooClient, QlooResult } from "./client";
import { ENDPOINTS } from "./constants";
import type { RunContext } from "./context";
import type { SearchParams } from "./schemas";
import { searchResponse, type QlooEntity } from "./types";

/**
 * Resolves a name to Qloo entities. `types` is required: without it, brand names resolve to single
 * stores or to people with the same name. Qloo answers 404 when nothing matches, which is returned
 * as an empty list. Results after the real match can be loosely related filler, so callers should
 * confirm the top hit instead of taking every result.
 */
export function searchEntities(
  client: QlooClient,
  ctx: RunContext,
  params: SearchParams,
  meta: { label?: string; stage?: string } = {},
): Promise<QlooResult<QlooEntity[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.search,
    params,
    schema: searchResponse,
    onNotFound: [],
    label: meta.label ?? `Searching Qloo for "${params.query}"`,
    stage: meta.stage,
  });
}
