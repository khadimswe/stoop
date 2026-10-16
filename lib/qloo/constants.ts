// Qloo hackathon API constants. Hackathon keys only work on this host (401 elsewhere).
export const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

export const ENDPOINTS = {
  search: "/search",
  tags: "/v2/tags",
  insights: "/v2/insights",
  // Confirmed by tasteplot fixtures and the official harness; /v2/insights/compare is an unverified alias.
  compare: "/v2/analysis/compare",
} as const;
export type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

// Entity types Qloo accepts. Note `videogame`: `video_game` returns 400.
export const ENTITY_TYPES = [
  "artist",
  "book",
  "brand",
  "destination",
  // Named places (cities, neighborhoods): searchable, and accepted by place queries as filter.location.
  "locality",
  "movie",
  "person",
  "place",
  "podcast",
  "tv_show",
  "videogame",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type EntityUrn = `urn:entity:${EntityType}`;
export const entityUrn = (type: EntityType): EntityUrn => `urn:entity:${type}`;

// Entity types Stoop queries through insights. Others are rejected until a gate needs them.
export const INSIGHT_ENTITY_TYPES = ["artist", "brand", "movie", "person", "place", "podcast", "tv_show"] as const;
export type InsightEntityType = (typeof INSIGHT_ENTITY_TYPES)[number];

export const OUTPUT_TYPES = {
  tag: "urn:tag",
  demographics: "urn:demographics",
  heatmap: "urn:heatmap",
} as const;

// Qloo age buckets. `24_and_younger` includes minors: Stoop labels it 18 to 24 and never targets under 18.
export const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

export const MAX_TAKE = 50;
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const STARTS_PER_SECOND = 4;
export const MAX_IN_FLIGHT = 4;
export const MAX_RETRIES = 3;
export const BACKOFF_BASE_MS = 500;
/**
 * Longest wait the client accepts before a retry. A longer Retry-After (e.g. the monthly quota is
 * spent) fails fast so the run can fall back to cache and a "partial data" badge instead of hanging.
 */
export const MAX_RETRY_WAIT_MS = 10_000;

// Status codes worth retrying. 500 "System Error" is deterministic for a given query, so it is not retried.
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Response headers worth keeping in evidence and fixtures. Everything else is dropped.
export const RATE_LIMIT_HEADERS = [
  "x-second-ratelimit-limit",
  "x-second-ratelimit-remaining",
  "x-second-ratelimit-reset",
  "x-month-ratelimit-limit",
  "x-month-ratelimit-remaining",
  "retry-after",
] as const;
