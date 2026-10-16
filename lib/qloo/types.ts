// Response schemas and normalized types.
//
// Verified against our own recordings in fixtures/ (Gate 2, Oct 16, 2026); every schema is tested
// against them in lib/qloo/types.test.ts. Schemas are loose: they check only the fields Stoop reads,
// keep everything else, and normalize the two quirks Qloo has: tags use `tag_id` in some responses
// and `id` in others, and entity results put the real type in `subtype` (with `type` "urn:entity").
import { z } from "zod";

const num = z.number();
const optNum = num.nullish();

// Tags appear as {id, ...} (insights entity tags, /v2/tags) or {tag_id, ...} (search, urn:tag, compare).
const rawTag = z.looseObject({
  id: z.string().optional(),
  tag_id: z.string().optional(),
  name: z.string(),
  type: z.string().nullish(),
  subtype: z.string().nullish(),
  popularity: optNum,
  query: z.looseObject({ affinity: optNum, score: optNum }).nullish(),
});

export interface QlooTag {
  id: string;
  name: string;
  type: string | null;
  popularity: number | null;
  affinity: number | null;
}

const tag = rawTag
  .refine((t) => !!(t.id ?? t.tag_id), { error: "tag has neither id nor tag_id" })
  .transform(
    (t): QlooTag => ({
      id: (t.id ?? t.tag_id) as string,
      name: t.name,
      type: t.subtype ?? t.type ?? null,
      popularity: t.popularity ?? null,
      affinity: t.query?.affinity ?? null,
    }),
  );

const explainabilityItem = z.looseObject({ entity_id: z.string(), score: num });

const rawEntity = z.looseObject({
  entity_id: z.string(),
  name: z.string(),
  type: z.string().nullish(),
  subtype: z.string().nullish(),
  types: z.array(z.string()).nullish(),
  popularity: optNum,
  disambiguation: z.string().nullish(),
  location: z.looseObject({ lat: num, lon: num, geohash: z.string().nullish() }).nullish(),
  properties: z.looseObject({}).nullish(),
  tags: z.array(tag).nullish(),
  query: z
    .looseObject({
      affinity: optNum,
      distance: optNum,
      explainability: z.record(z.string(), z.array(explainabilityItem)).nullish(),
    })
    .nullish(),
});

export interface QlooEntity {
  id: string;
  name: string;
  /** Real entity type, e.g. "urn:entity:brand", read from `subtype` or `types[0]`. */
  type: string | null;
  popularity: number | null;
  affinity: number | null;
  disambiguation: string | null;
  location: { lat: number; lon: number; geohash: string | null } | null;
  tags: QlooTag[];
  /** Which input signals drove this result, when feature.explainability=true. */
  explainability: Record<string, { entityId: string; score: number }[]> | null;
  properties: Record<string, unknown> | null;
}

const entity = rawEntity.transform(
  (e): QlooEntity => ({
    id: e.entity_id,
    name: e.name,
    type: e.subtype ?? e.types?.[0] ?? (e.type && e.type !== "urn:entity" ? e.type : null),
    popularity: e.popularity ?? null,
    affinity: e.query?.affinity ?? null,
    disambiguation: e.disambiguation || null,
    location: e.location ? { lat: e.location.lat, lon: e.location.lon, geohash: e.location.geohash ?? null } : null,
    tags: e.tags ?? [],
    explainability: e.query?.explainability
      ? Object.fromEntries(
          Object.entries(e.query.explainability).map(([signal, items]) => [
            signal,
            items.map((item) => ({ entityId: item.entity_id, score: item.score })),
          ]),
        )
      : null,
    properties: e.properties ?? null,
  }),
);

/** GET /search: `results` is a bare array. */
export const searchResponse = z
  .looseObject({ results: z.array(entity) })
  .transform((r) => r.results);

/** GET /v2/tags: tags live under `results.tags` and use `id`. */
export const tagsResponse = z
  .looseObject({ results: z.looseObject({ tags: z.array(tag) }) })
  .transform((r) => r.results.tags);

/** GET /v2/insights with filter.type=urn:entity:*. */
export const insightsEntitiesResponse = z
  .looseObject({ results: z.looseObject({ entities: z.array(entity) }) })
  .transform((r) => r.results.entities);

/** GET /v2/insights with filter.type=urn:tag. */
export const insightsTagsResponse = z
  .looseObject({ results: z.looseObject({ tags: z.array(tag) }) })
  .transform((r) => r.results.tags);

export interface DemographicsRow {
  /** The signal this row describes: an entity id, or a tag id when tags were sent. */
  signalId: string;
  /** Relative skew index from -1 to 1 per age bucket. Not an audience share. */
  age: Record<string, number>;
  /** Relative skew index from -1 to 1. Not an audience share. */
  gender: Record<string, number>;
}

/** GET /v2/insights with filter.type=urn:demographics. One row per signal with data. */
export const demographicsResponse = z
  .looseObject({
    results: z.looseObject({
      demographics: z.array(
        z.looseObject({
          entity_id: z.string(),
          query: z.looseObject({
            age: z.record(z.string(), num).nullish(),
            gender: z.record(z.string(), num).nullish(),
          }),
        }),
      ),
    }),
  })
  .transform((r): DemographicsRow[] =>
    r.results.demographics.map((row) => ({
      signalId: row.entity_id,
      age: row.query.age ?? {},
      gender: row.query.gender ?? {},
    })),
  );

export interface HeatmapCell {
  geohash: string;
  lat: number;
  lon: number;
  /** Percentile-like within this response; tracks popularity closely, so rank by lift instead. */
  affinity: number;
  affinityRank: number | null;
  popularity: number;
}

const heatmapCell = z.looseObject({
  location: z.looseObject({ latitude: num, longitude: num, geohash: z.string() }),
  query: z.looseObject({ affinity: num, affinity_rank: optNum, popularity: num }),
});

/** GET /v2/insights with filter.type=urn:heatmap. `take` is ignored; responses can hold thousands of cells. */
export const heatmapResponse = z
  .looseObject({ results: z.looseObject({ heatmap: z.array(heatmapCell) }) })
  .transform((r): HeatmapCell[] =>
    r.results.heatmap.map((cell) => ({
      geohash: cell.location.geohash,
      lat: cell.location.latitude,
      lon: cell.location.longitude,
      affinity: cell.query.affinity,
      affinityRank: cell.query.affinity_rank ?? null,
      popularity: cell.query.popularity,
    })),
  );

/**
 * Keeps only the heatmap fields Stoop reads, before caching. Raw heatmap bodies run 0.5 to 2.2 MB.
 * Leaves unexpected shapes untouched so the response schema can report them.
 */
export function slimHeatmapBody(body: unknown): unknown {
  const parsed = z
    .looseObject({ results: z.looseObject({ heatmap: z.array(heatmapCell) }) })
    .safeParse(body);
  if (!parsed.success) return body;
  return {
    results: {
      heatmap: parsed.data.results.heatmap.map((cell) => ({
        location: {
          latitude: cell.location.latitude,
          longitude: cell.location.longitude,
          geohash: cell.location.geohash,
        },
        query: {
          affinity: cell.query.affinity,
          affinity_rank: cell.query.affinity_rank ?? null,
          popularity: cell.query.popularity,
        },
      })),
    },
  };
}

/**
 * The locality Qloo matched for `filter.location.query`, echoed at `query.localities.filter`
 * (fixtures/pool-segments.json.gz: "Baton Rouge, LA" -> "East Baton Rouge Parish, Louisiana,
 * United States"). Null when Qloo sent no echo (it omits it when several localities match).
 */
export const localityEcho = z
  .looseObject({
    query: z
      .looseObject({
        localities: z
          .looseObject({ filter: z.array(z.looseObject({ name: z.string(), disambiguation: z.string().nullish() })).nullish() })
          .nullish(),
      })
      .nullish(),
  })
  .transform((r) => {
    const first = r.query?.localities?.filter?.[0];
    return first ? { name: first.name, disambiguation: first.disambiguation ?? "" } : null;
  });

export interface CompareResult {
  /** Tags both audiences share, scored by Qloo. */
  shared: (QlooTag & { score: number | null })[];
  /** Tags distinctive to side a and side b. */
  a: QlooTag[];
  b: QlooTag[];
}

const compareTag = rawTag.transform((t) => ({
  id: (t.tag_id ?? t.id ?? "") as string,
  name: t.name,
  type: t.subtype ?? t.type ?? null,
  popularity: t.popularity ?? null,
  affinity: null,
  score: t.query?.score ?? null,
}));

/** GET /v2/analysis/compare. No `success` key; `count` arrives as a string. */
export const compareResponse = z
  .looseObject({
    results: z.looseObject({
      tags: z.array(compareTag).nullish(),
      a: z.array(tag).nullish(),
      b: z.array(tag).nullish(),
    }),
  })
  .transform(
    (r): CompareResult => ({
      shared: r.results.tags ?? [],
      a: r.results.a ?? [],
      b: r.results.b ?? [],
    }),
  );

// Slimming. Entity bodies are large (a 50-movie response is about 2 MB, mostly keyword tags, akas,
// websites and plot text), so search and entity insights are slimmed before caching and before a
// fixture is committed, the same way heatmaps are. Only fields are dropped; no value is changed.

/** Entity properties Stoop reads: craft translation (film/TV style, music feel, brand aesthetics) and settings. */
const KEPT_PROPERTIES = new Set([
  // film and TV (content_rating lets visual references skip titles rated for children)
  "release_year",
  "content_rating",
  "genres",
  "genre_description",
  "style_description",
  "emotional_tone_description",
  "situational_contexts",
  // artists
  "primary_genres",
  "secondary_genres",
  "adjectives_for_music",
  "creative_and_specific_adjectives_for_music",
  "instruments",
  "start_year",
  "obscurity_scale",
  // brands
  "aesthetic_properties",
  "personal_style",
  "emotional_tone",
  "lifestyle",
  "category_description",
  "industries",
  "price_range_usd_min",
  "price_range_usd_max",
  // places
  "address",
  "geocode",
  "locality",
  "neighborhood",
  "primary_genre",
  "price_level",
  "business_rating",
  "specialty_dishes",
  "cuisine_description",
  "ambience_description",
  "physical_setting_description",
  "neighborhood_description",
  // people and podcasts
  "short_description",
  "known_for",
]);
// Not kept on purpose: audience_identity, target_demographics_description and
// customer_demographics_description describe people by background or demographics. Stoop never
// builds segments or prompts from text labels (segments come from affinities and skews only).

/**
 * Entity tag types Stoop reads: genre and style for craft translation (film/TV to visual language,
 * artists to music feel), aesthetics and lifestyle for wardrobe, ambience and setting for places.
 * Raw media keywords, Wikipedia categories, plot and character tags are most of the bytes and are
 * dropped. The full bodies stay in the gitignored fixtures/raw/, so a later gate can re-slim with
 * `fixtures:record -- <name> --reslim` without spending calls.
 */
const KEPT_TAG_TYPES = new Set([
  "urn:tag:subgenre:qloo",
  "urn:tag:style:qloo",
  "urn:tag:theme:qloo",
  "urn:tag:music:qloo",
  "urn:tag:instrument:qloo",
  "urn:tag:aesthetic_property:qloo",
  "urn:tag:lifestyle:qloo",
  "urn:tag:emotional_tone:qloo",
  "urn:tag:interest_adjacency:qloo",
  "urn:tag:ambience:qloo",
  "urn:tag:setting:qloo",
  "urn:tag:decor:qloo",
  "urn:tag:neighborhood_characteristic:qloo",
  "urn:tag:activity_type:qloo",
  "urn:tag:specialty_dish:place",
]);
// Kept tag names can still describe people or imply minors ("Teen Pop", "Classroom centric"), so
// Gate 4 runs the guardrails' checkText on every tag before craft translation uses it.
const keepTag = (type: unknown) => typeof type === "string" && (type.startsWith("urn:tag:genre:") || KEPT_TAG_TYPES.has(type));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slimEntity(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const kept: Record<string, unknown> = {};
  for (const key of ["entity_id", "name", "type", "subtype", "types", "popularity", "disambiguation", "location", "query"]) {
    if (key in value) kept[key] = value[key];
  }
  if (isRecord(value.properties)) {
    kept.properties = Object.fromEntries(Object.entries(value.properties).filter(([key]) => KEPT_PROPERTIES.has(key)));
  }
  if (Array.isArray(value.tags)) {
    kept.tags = value.tags
      .filter((t) => isRecord(t) && keepTag(t.type))
      .map((t) => (isRecord(t) ? Object.fromEntries(["id", "tag_id", "name", "type"].filter((k) => k in t).map((k) => [k, t[k]])) : t));
  }
  return kept;
}

/** Slims `{results: [...]}` (search) and `{results: {entities: [...]}}` (entity insights). Other shapes pass through. */
export function slimEntitiesBody(body: unknown): unknown {
  if (!isRecord(body)) return body;
  const { results } = body;
  if (Array.isArray(results)) return { ...body, results: results.map(slimEntity) };
  if (isRecord(results) && Array.isArray(results.entities)) {
    return { ...body, results: { ...results, entities: results.entities.map(slimEntity) } };
  }
  return body;
}

/** The slimmer for a request, by endpoint and filter.type. Used by the client before caching and by the fixture recorder. */
export function slimBody(endpoint: string, filterType: unknown, body: unknown): unknown {
  if (filterType === "urn:heatmap") return slimHeatmapBody(body);
  if (endpoint === "/search") return slimEntitiesBody(body);
  if (endpoint === "/v2/insights" && typeof filterType === "string" && filterType.startsWith("urn:entity:")) {
    return slimEntitiesBody(body);
  }
  return body;
}
