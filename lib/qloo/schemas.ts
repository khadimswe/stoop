// Request validation. Qloo silently ignores params that do not apply and still returns 200 with
// quietly wrong data, so every request is checked here before it is sent. Unknown keys throw.
//
// Allowed params per type come from Qloo's official table
// (github.com/qloo/docs-public, reference/available-parameters-by-entity-type.md), narrowed to the
// params Stoop actually sends. Live behavior notes come from public 2026 hackathon repos and are
// UNVERIFIED until our own fixtures are recorded (Slice 2).
import { z } from "zod";
import {
  AGE_BUCKETS,
  ENDPOINTS,
  ENTITY_TYPES,
  GENDERS,
  INSIGHT_ENTITY_TYPES,
  MAX_TAKE,
  type Endpoint,
  type InsightEntityType,
} from "./constants";
import { QlooParamError } from "./errors";
import type { QlooParams } from "./params";

// UNVERIFIED: every entity id seen in public fixtures is a UUID. Loosen if Slice 2 shows otherwise.
const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_ID = /^urn:tag:[a-z0-9_.:-]+$/i;
const TAG_TYPE = /^urn:tag:[a-z0-9_.:-]+$/i;
const NUMBER = "(-?\\d+(?:\\.\\d+)?)";
const WKT_POINT = new RegExp(`^POINT\\(${NUMBER} ${NUMBER}\\)$`);
const WKT_AREA = /^(MULTI)?POLYGON\s*\(\(.+\)\)$/;

const entityId = z.string().regex(ENTITY_ID, { error: "must be a Qloo entity id (UUID)" });
const tagId = z.string().regex(TAG_ID, { error: "must be a tag id like urn:tag:genre:music:jazz" });
const entityIds = z.array(entityId).min(1).max(MAX_TAKE);
const tagIds = z.array(tagId).min(1).max(MAX_TAKE);
const entityTypeUrn = z.enum(ENTITY_TYPES.map((t) => `urn:entity:${t}` as const));
const take = z.number().int().min(1).max(MAX_TAKE);
const unit = z.number().min(0).max(1);
const radiusMeters = z.number().positive().max(1_000_000);
const nonEmpty = z.string().trim().min(1).max(200);

function checkPoint(value: string, ctx: z.RefinementCtx): void {
  const match = WKT_POINT.exec(value);
  if (!match) {
    ctx.addIssue({ code: "custom", message: "must be WKT POINT(lon lat)" });
    return;
  }
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (lon < -180 || lon > 180) ctx.addIssue({ code: "custom", message: "longitude must be within -180..180" });
  if (lat < -90 || lat > 90) {
    ctx.addIssue({ code: "custom", message: "latitude must be within -90..90; WKT is POINT(lon lat), not POINT(lat lon)" });
  }
}

/** WKT point, longitude first. `POINT(lat lon)` silently returns 0 results, so obvious swaps are rejected. */
export const wktPoint = z.string().superRefine(checkPoint);

/** A WKT point, or a polygon for region-wide heatmaps. */
const wktLocation = z.string().superRefine((value, ctx) => {
  if (WKT_AREA.test(value)) return;
  checkPoint(value, ctx);
});

/** Builds a WKT point in the order Qloo expects. Prefer this over hand-written strings. */
export function toWktPoint(coords: { lat: number; lon: number }): string {
  return `POINT(${coords.lon} ${coords.lat})`;
}

// Params the docs allow but Qloo is reported to ignore, plus common mistakes. These get a specific
// message instead of the generic "unknown param" one.
const IGNORED_OR_WRONG: Record<string, string> = {
  "filter.location":
    "filter.location is silently ignored for this type (reported for brand and artist). Use signal.location to re-rank instead",
  "filter.location.query": "filter.location.query is silently ignored for this type. Use signal.location.query instead",
  "filter.release_country": "filter.release_country is silently ignored for movie (reported by tastebridge)",
  "bias.trends": "bias.trends is not used: trending data ends Sept 2025 and it is rejected for book and videogame",
};

function unknownKeysMessage(keys: readonly PropertyKey[], notes: Record<string, string>): string {
  return keys
    .map((key) => {
      const name = String(key);
      return notes[name] ?? IGNORED_OR_WRONG[name] ?? `unknown param "${name}" (not allowed for this request)`;
    })
    .join("; ");
}

/** Strict object: unknown keys fail, with a specific message for known traps. */
function strict<Shape extends z.ZodRawShape>(shape: Shape, notes: Record<string, string> = {}) {
  return z.strictObject(shape, {
    error: (issue) => (issue.code === "unrecognized_keys" ? unknownKeysMessage(issue.keys, notes) : undefined),
  });
}

const signalShape = {
  "signal.interests.entities": entityIds.optional(),
  "signal.interests.tags": tagIds.optional(),
  "signal.demographics.age": z.array(z.enum(AGE_BUCKETS)).min(1).optional(),
  "signal.demographics.gender": z.enum(GENDERS).optional(),
};

// UNVERIFIED: not in the per-type table, but headliner and tasteplot report it re-ranks artist and brand results.
const signalLocationShape = {
  "signal.location": wktLocation.optional(),
  "signal.location.radius": radiusMeters.optional(),
  "signal.location.query": nonEmpty.optional(),
};

const entityFilterShape = {
  "filter.tags": tagIds.optional(),
  "operator.filter.tags": z.enum(["union", "intersection"]).optional(),
  "filter.exclude.tags": tagIds.optional(),
  "filter.exclude.entities": entityIds.optional(),
  "filter.results.entities": entityIds.optional(),
  "filter.popularity.min": unit.optional(),
  "filter.popularity.max": unit.optional(),
  "feature.explainability": z.boolean().optional(),
  take: take.optional(),
};

type Signals = {
  "signal.interests.entities"?: readonly string[];
  "signal.interests.tags"?: readonly string[];
  "signal.demographics.age"?: readonly string[];
  "signal.demographics.gender"?: string;
};

function requireSignal(value: Signals, ctx: z.RefinementCtx) {
  const hasSignal =
    !!value["signal.interests.entities"]?.length ||
    !!value["signal.interests.tags"]?.length ||
    !!value["signal.demographics.age"]?.length ||
    !!value["signal.demographics.gender"];
  if (!hasSignal) {
    ctx.addIssue({
      code: "custom",
      message: "needs at least one signal (signal.interests.entities, signal.interests.tags, or signal.demographics.*)",
    });
  }
}

function entitySchema<T extends InsightEntityType>(type: T, extra: z.ZodRawShape = {}) {
  return strict({
    "filter.type": z.literal(`urn:entity:${type}` as const),
    ...signalShape,
    ...signalLocationShape,
    ...entityFilterShape,
    ...extra,
  }).superRefine((value, ctx) => requireSignal(value as Signals, ctx));
}

const placeSchema = strict({
  "filter.type": z.literal("urn:entity:place"),
  ...signalShape,
  ...entityFilterShape,
  "filter.location": wktLocation.optional(),
  "filter.location.radius": radiusMeters.optional(),
  "filter.location.query": nonEmpty.optional(),
}).superRefine((value, ctx) => {
  requireSignal(value as Signals, ctx);
  // Stoop rule: settings are always local to a segment, so a place query must be anchored.
  if (!value["filter.location"] && !value["filter.location.query"]) {
    ctx.addIssue({ code: "custom", message: "place queries need filter.location (WKT) or filter.location.query" });
  }
});

const tagInsightsSchema = strict({
  "filter.type": z.literal("urn:tag"),
  ...signalShape,
  ...signalLocationShape,
  "filter.tag.types": z.array(z.string().regex(TAG_TYPE)).min(1).optional(),
  "filter.parents.types": z.array(entityTypeUrn).min(1).optional(),
  "diversify.by": z.enum(["subtype"]).optional(),
  "diversify.take": take.optional(),
  take: take.optional(),
}).superRefine((value, ctx) => requireSignal(value as Signals, ctx));

const demographicsSchema = strict({
  "filter.type": z.literal("urn:demographics"),
  "signal.interests.entities": entityIds.optional(),
  "signal.interests.tags": tagIds.optional(),
}).superRefine((value, ctx) => requireSignal(value as Signals, ctx));

const heatmapSchema = strict(
  {
    "filter.type": z.literal("urn:heatmap"),
    ...signalShape,
    "filter.location": wktLocation.optional(),
    "filter.location.radius": radiusMeters.optional(),
    "filter.location.query": nonEmpty.optional(),
    // Only urn:geohash works; urn:entity:locality returns 500 and city/neighborhood return 400.
    "output.heatmap.boundary": z.literal("urn:geohash").optional(),
  },
  { take: "take is ignored for heatmaps; Qloo returns every cell" },
).superRefine((value, ctx) => {
  requireSignal(value as Signals, ctx);
  if (!value["filter.location"] && !value["filter.location.query"]) {
    ctx.addIssue({ code: "custom", message: "heatmaps need filter.location or filter.location.query" });
  }
});

export const insightsSchemas = {
  "urn:entity:artist": entitySchema("artist"),
  "urn:entity:brand": entitySchema("brand"),
  "urn:entity:movie": entitySchema("movie", {
    "filter.release_year.min": z.number().int().min(1880).max(2100).optional(),
    "filter.release_year.max": z.number().int().min(1880).max(2100).optional(),
  }),
  "urn:entity:person": entitySchema("person"),
  "urn:entity:podcast": entitySchema("podcast"),
  "urn:entity:tv_show": entitySchema("tv_show"),
  "urn:entity:place": placeSchema,
  "urn:tag": tagInsightsSchema,
  "urn:demographics": demographicsSchema,
  "urn:heatmap": heatmapSchema,
} as const;
export type InsightsFilterType = keyof typeof insightsSchemas;
export type InsightsParams<T extends InsightsFilterType> = z.input<(typeof insightsSchemas)[T]>;

export const searchSchema = strict({
  query: nonEmpty,
  // Always pass types: without it, brand names resolve to single stores or to people with the same name.
  types: z.array(entityTypeUrn).min(1),
  take: take.optional(),
});
export type SearchParams = z.input<typeof searchSchema>;

export const tagsSchema = strict({
  "filter.query": nonEmpty,
  "filter.tag.types": z.array(z.string().regex(TAG_TYPE)).min(1).optional(),
  "filter.parents.types": z.array(entityTypeUrn).min(1).optional(),
  take: take.optional(),
});
export type TagsParams = z.input<typeof tagsSchema>;

export const compareSchema = strict({
  "a.signal.interests.entities": entityIds,
  "b.signal.interests.entities": entityIds,
  take: take.optional(),
});
export type CompareParams = z.input<typeof compareSchema>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message));
}

function insightsSchemaFor(params: QlooParams): z.ZodType {
  const type = params["filter.type"];
  if (type === "urn:entity:video_game") {
    throw new QlooParamError(ENDPOINTS.insights, ['filter.type: use "urn:entity:videogame"; "video_game" returns 400']);
  }
  if (typeof type !== "string" || !Object.hasOwn(insightsSchemas, type)) {
    const allowed = [...INSIGHT_ENTITY_TYPES.map((t) => `urn:entity:${t}`), "urn:tag", "urn:demographics", "urn:heatmap"];
    throw new QlooParamError(ENDPOINTS.insights, [
      `filter.type must be one of ${allowed.join(", ")} (one type per call), got ${JSON.stringify(type)}`,
    ]);
  }
  return insightsSchemas[type as InsightsFilterType];
}

function schemaFor(endpoint: Endpoint, params: QlooParams): z.ZodType {
  switch (endpoint) {
    case ENDPOINTS.search:
      return searchSchema;
    case ENDPOINTS.tags:
      return tagsSchema;
    case ENDPOINTS.compare:
      return compareSchema;
    case ENDPOINTS.insights:
      return insightsSchemaFor(params);
  }
}

/** Throws QlooParamError (before any network call) unless params are valid for the endpoint. */
export function validateParams(endpoint: Endpoint, params: QlooParams): void {
  const result = schemaFor(endpoint, params).safeParse(params);
  if (!result.success) throw new QlooParamError(endpoint, formatIssues(result.error));
}
