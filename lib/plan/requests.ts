// Every Qloo request a plan makes, as params built from the inputs, so the pipeline, the recorder and
// the tests send byte-identical requests (the cache and the fixtures key on them). What each one is
// for, and what Oct 28's data check found about it, is in docs/store-events-memo.md:
// - city: artists and music styles by city name (signal.location.query) and the adult age bands. A
//   map-point signal barely re-ranks taste, and neighborhood names resolve inconsistently.
// - block: places within a radius of the store (filter.location POINT), one category per call, with
//   the age signal and explainability. A business's own listing is never used as a taste signal.
import { z } from "zod";
import { toWktPoint } from "../qloo/schemas";
import { insightsEntitiesResponse, type QlooEntity } from "../qloo/types";
import type { PlanInputs } from "./schema";
import { BLOCK_CATEGORIES, type BlockCategory } from "./taste";

/** Places are searched within this distance of the store unless a run says otherwise. */
export const DEFAULT_RADIUS_M = 1500;
export const CITY_ARTISTS_TAKE = 20;
export const CITY_STYLES_TAKE = 30;

const ages = (inputs: PlanInputs) => [...inputs.ageBands];

export function cityArtistsParams(inputs: PlanInputs) {
  return { "filter.type": "urn:entity:artist", "signal.location.query": inputs.store.city, "signal.demographics.age": ages(inputs), take: CITY_ARTISTS_TAKE } as const;
}

export function cityStylesParams(inputs: PlanInputs) {
  return {
    "filter.type": "urn:tag",
    "filter.tag.types": ["urn:tag:genre:music"],
    "signal.location.query": inputs.store.city,
    "signal.demographics.age": ages(inputs),
    take: CITY_STYLES_TAKE,
  } as const;
}

/** Where the block is read: the event's own location when it is away from the store, else the store. */
export const blockPoint = (inputs: PlanInputs) => inputs.location?.point ?? inputs.store.point;

export function blockParams(inputs: PlanInputs, category: BlockCategory, radiusM: number = DEFAULT_RADIUS_M) {
  const { tags, take } = BLOCK_CATEGORIES[category];
  return {
    "filter.type": "urn:entity:place",
    "signal.demographics.age": ages(inputs),
    "filter.location": toWktPoint(blockPoint(inputs)),
    "filter.location.radius": radiusM,
    "filter.tags": [...tags],
    "operator.filter.tags": "union",
    "feature.explainability": true,
    take,
  } as const;
}

/** /search for one of the generic plan's named picks. Always typed, so a name never resolves to the wrong kind of thing. */
export function pickSearchParams(name: string, type: "artist" | "brand") {
  return { query: name, types: [`urn:entity:${type}` as const], take: 5 };
}

/**
 * Qloo's own city artists and the generic plan's artists in ONE call with the same city signal, so
 * their affinities compare (never across calls). `take` covers every id, or Qloo cuts the list.
 */
export function scoreArtistsParams(inputs: PlanInputs, ids: readonly string[]) {
  return {
    "filter.type": "urn:entity:artist",
    "signal.location.query": inputs.store.city,
    "signal.demographics.age": ages(inputs),
    "filter.results.entities": [...ids],
    take: Math.max(ids.length, 1),
  } as const;
}

/** A place with Qloo's distance from the store (meters), which the shared entity shape does not keep. */
export type PlaceEntity = QlooEntity & { distance: number | null };

const distances = z.looseObject({
  results: z.looseObject({
    entities: z.array(z.looseObject({ entity_id: z.string(), query: z.looseObject({ distance: z.number().nullish() }).nullish() })),
  }),
});

/** Place insights, keeping each place's distance from filter.location. */
export const placesResponse = z.unknown().transform((body, ctx): PlaceEntity[] => {
  const entities = insightsEntitiesResponse.safeParse(body);
  if (!entities.success) {
    for (const issue of entities.error.issues.slice(0, 3)) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    return z.NEVER;
  }
  const raw = distances.safeParse(body);
  const byId = new Map(raw.success ? raw.data.results.entities.map((e) => [e.entity_id, e.query?.distance ?? null]) : []);
  return entities.data.map((entity) => ({ ...entity, distance: byId.get(entity.id) ?? null }));
});
