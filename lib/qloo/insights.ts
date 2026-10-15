import type { QlooClient, QlooResult } from "./client";
import { ENDPOINTS, type InsightEntityType } from "./constants";
import type { RunContext } from "./context";
import type { InsightsParams } from "./schemas";
import {
  demographicsResponse,
  heatmapResponse,
  insightsEntitiesResponse,
  insightsTagsResponse,
  slimHeatmapBody,
  type DemographicsRow,
  type HeatmapCell,
  type QlooEntity,
  type QlooTag,
} from "./types";

type Meta = { label?: string; stage?: string };
type EntityFilterType = `urn:entity:${InsightEntityType}`;

/** Cross-domain affinities: the artists, films, brands, places, people, or podcasts an audience over-indexes on. */
export function insightsEntities<T extends EntityFilterType>(
  client: QlooClient,
  ctx: RunContext,
  params: InsightsParams<T>,
  meta: Meta = {},
): Promise<QlooResult<QlooEntity[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.insights,
    params,
    schema: insightsEntitiesResponse,
    label: meta.label ?? `Asking Qloo which ${params["filter.type"].replace("urn:entity:", "")} entities this audience loves`,
    stage: meta.stage,
  });
}

/** The taste "DNA" behind an audience, as tags. */
export function insightsTags(
  client: QlooClient,
  ctx: RunContext,
  params: InsightsParams<"urn:tag">,
  meta: Meta = {},
): Promise<QlooResult<QlooTag[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.insights,
    params,
    schema: insightsTagsResponse,
    label: meta.label ?? "Reading this audience's taste tags",
    stage: meta.stage,
  });
}

/** Age and gender skew per signal. Values are relative indices from -1 to 1, not audience shares. */
export function insightsDemographics(
  client: QlooClient,
  ctx: RunContext,
  params: InsightsParams<"urn:demographics">,
  meta: Meta = {},
): Promise<QlooResult<DemographicsRow[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.insights,
    params,
    schema: demographicsResponse,
    label: meta.label ?? "Measuring who skews toward these tastes",
    stage: meta.stage,
  });
}

/**
 * Where an audience clusters. Raw affinity tracks popularity, so rank the cells with `lift.ts`.
 * Bodies are slimmed before caching because they can hold thousands of cells.
 */
export function insightsHeatmap(
  client: QlooClient,
  ctx: RunContext,
  params: InsightsParams<"urn:heatmap">,
  meta: Meta = {},
): Promise<QlooResult<HeatmapCell[]>> {
  return client.request(ctx, {
    endpoint: ENDPOINTS.insights,
    params,
    schema: heatmapResponse,
    slim: slimHeatmapBody,
    label: meta.label ?? "Mapping where this audience clusters",
    stage: meta.stage,
  });
}
