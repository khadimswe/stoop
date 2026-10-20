// Culture, the sweep: the Qloo material each concept world's brief is written from. Per world, with
// the world's own signal (the seeds plus its age bucket, exactly as Segments sends it, so the artist
// and brand calls replay from there): films and TV shows for the visual language, and everyday places
// in the world's setting city for its settings, with Qloo's explainability. Once per run, with the
// audience's signal: the people and podcasts this taste neighborhood follows, for creators and voice.
//
// The setting city is never picked by us: it is one of the audience's own stable top cities (Prove),
// the one this world's age band ranks highest, so the age effect in a segment's own heatmap (college
// towns for 18 to 24) never decides a setting. Places run against the city's verified Qloo locality,
// never a fuzzy name, and chains (a name Qloo returns twice or more) are dropped.
import { checkText } from "../guardrails";
import { acceptLocality, liftByMetro, localityName, METROS, placeAnchor, type MetroLift, type ReferenceSets } from "../geo/metros";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import type { QlooParams } from "../qloo/params";
import { insightsEntitiesResponse, searchResponse, slimEntitiesBody, type HeatmapCell, type QlooEntity } from "../qloo/types";
import type { CultureField, PanelPosition, SettingCity } from "../report/world";
import type { EntityRef, Proof, Seed, Segment } from "../report/schema";
import type { SegmentRaw } from "./segments";
import { ageBandLabel } from "../types";
import { decide, qloo, type StageEnv } from "./env";
import { seedSignal, TOP_CITIES } from "./prove";

/** Films and shows per world: enough for 10 to score and a few to spare after the guardrails. */
export const SCREEN_TAKE = 30;
export const PLACE_TAKE = 20;
export const CREATOR_TAKE = 20;
/** How many of each list the brief may draw on (and the check scores). */
export const TOP_PICKS = 10;
/** Details (Qloo properties, place tags) kept per candidate for craft translation. */
export const MAX_DETAILS = 6;

/**
 * Everyday place genres, as Gate 2 resolved them through /v2/tags (fixtures/pool-resolve.json:
 * "coffee shop", "park", "boutique", "record store"). The agent can probe one genre on its own.
 */
export const EVERYDAY_PLACE_TAGS = [
  "urn:tag:genre:place:restaurant:coffee_shop",
  "urn:tag:genre:place:park",
  "urn:tag:genre:place:boutique",
  "urn:tag:genre:place:record_store",
] as const;

/** Ratings for titles made for children: never a visual reference for an adult world. */
export const CHILD_RATINGS: ReadonlySet<string> = new Set(["G", "TV-Y", "TV-Y7", "TV-Y7-FV"]);

/** The signal every call in one world sends: the seeds plus its age bucket (Segments sends the same). */
export function worldSignal(seeds: readonly Seed[], bucket: AgeBucket): QlooParams {
  return { ...seedSignal(seeds), "signal.demographics.age": [bucket] };
}

export type PlaceAnchor = { "filter.location": string; "filter.location.radius"?: number };

/** A world's sweep requests, exported so recordings can be planned from the same params. */
export function cultureRequests(seeds: readonly Seed[], bucket: AgeBucket, anchor: PlaceAnchor | null) {
  const signal = worldSignal(seeds, bucket);
  return {
    movie: { ...signal, "filter.type": "urn:entity:movie", take: SCREEN_TAKE },
    tv_show: { ...signal, "filter.type": "urn:entity:tv_show", take: SCREEN_TAKE },
    place: anchor
      ? {
          ...signal,
          "filter.type": "urn:entity:place",
          ...anchor,
          "filter.tags": [...EVERYDAY_PLACE_TAGS],
          "operator.filter.tags": "union",
          "feature.explainability": true,
          take: PLACE_TAKE,
        }
      : null,
  } satisfies Record<string, QlooParams | null>;
}

/** The run's creator requests: the audience's signal, people and podcasts. */
export function creatorRequests(seeds: readonly Seed[]) {
  const signal = seedSignal(seeds);
  return {
    person: { ...signal, "filter.type": "urn:entity:person", take: CREATOR_TAKE },
    podcast: { ...signal, "filter.type": "urn:entity:podcast", take: CREATOR_TAKE },
  } satisfies Record<string, QlooParams>;
}

/** The locality search for a city (the same params the Gate 2 data check recorded). */
export function localityParams(city: string): QlooParams {
  return { query: city, types: ["urn:entity:locality"], take: 5 };
}

/**
 * One Qloo item a world's brief may draw on, with the field it can back. Names are for the report
 * and the trace only: prompts never carry them. `details` are Qloo's own descriptors (a film's style
 * description, an artist's adjectives, a place's genre and setting tags), guardrailed, for craft.
 */
export interface CultureCandidate {
  kind: "entity" | "tag";
  id: string;
  name: string;
  type: string;
  field: CultureField;
  /** Position in its own Qloo response, after the guardrails (1 = top). */
  rank: number;
  /** Filled by the check: where it lands against the frozen panel; null when its type has no panel. */
  position: PanelPosition | null;
  why: string[];
  details: string[];
  evidenceIds: string[];
}

const guarded = (text: string) => checkText(text).some((issue) => issue.rule === "minor" || issue.rule === "ethnicity");

/** Qloo's own descriptors worth translating into craft, by entity type, capped and guardrailed. */
function detailsOf(entity: QlooEntity): string[] {
  const props = entity.properties ?? {};
  const words: unknown[] = [];
  const add = (...keys: string[]) => {
    for (const key of keys) {
      const value = props[key];
      if (Array.isArray(value)) words.push(...value);
      else if (value !== undefined && value !== null) words.push(value);
    }
  };
  if (entity.type === "urn:entity:movie" || entity.type === "urn:entity:tv_show") add("style_description", "genre_description", "emotional_tone_description", "genres", "release_year");
  else if (entity.type === "urn:entity:artist") add("primary_genres", "adjectives_for_music", "creative_and_specific_adjectives_for_music", "instruments", "start_year");
  else if (entity.type === "urn:entity:brand") add("aesthetic_properties", "personal_style", "emotional_tone", "lifestyle");
  else words.push(...entity.tags.map((tag) => tag.name));
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const word of words) {
    const text = String(word).trim();
    const key = text.toLowerCase();
    if (!text || text.length > 160 || seen.has(key) || guarded(text)) continue;
    seen.add(key);
    kept.push(text);
    if (kept.length >= MAX_DETAILS) break;
  }
  return kept;
}

/** Entities as candidates for one field: guardrailed names, children's titles left out, ranked as kept. */
export function entityCandidates(entities: readonly QlooEntity[], field: CultureField, evidenceId: string, limit = TOP_PICKS, rankOf?: (entity: QlooEntity) => number): CultureCandidate[] {
  const kept: CultureCandidate[] = [];
  for (const entity of entities) {
    if (kept.length >= limit) break;
    if (guarded(entity.name)) continue;
    const rating = entity.properties?.content_rating;
    if (typeof rating === "string" && CHILD_RATINGS.has(rating.trim().toUpperCase())) continue;
    kept.push({
      kind: "entity",
      id: entity.id,
      name: entity.name,
      type: entity.type ?? "urn:entity",
      field,
      rank: rankOf ? rankOf(entity) : kept.length + 1,
      position: null,
      why: [],
      details: detailsOf(entity),
      evidenceIds: [evidenceId],
    });
  }
  return kept;
}

/** Tags as candidates for one field (Prove's music and tone tags). */
export function tagCandidates(tags: readonly { id: string; name: string; rank: number; evidenceIds: string[] }[], field: CultureField, type: string): CultureCandidate[] {
  return tags.map((tag) => ({ kind: "tag", id: tag.id, name: tag.name, type, field, rank: tag.rank, position: null, why: [], details: [], evidenceIds: tag.evidenceIds }));
}

/** "Fans of Tabasco and Hot Ones": the two seeds that drove a place most, from Qloo's explainability. */
export function placeWhy(entity: QlooEntity, seedNames: ReadonlyMap<string, string>): string[] {
  const items = Object.values(entity.explainability ?? {}).flat();
  const names = [...items]
    .sort((a, b) => b.score - a.score)
    .map((item) => seedNames.get(item.entityId))
    .filter((name): name is string => Boolean(name));
  const top = [...new Set(names)].slice(0, 2);
  return top.length ? [`Fans of ${top.join(" and ")}`] : [];
}

/**
 * Places as candidates: a name Qloo returns twice or more is a chain and is dropped entirely (Gate 2:
 * national coffee and fast-food chains fill everyday-place results), as are names the guardrails stop.
 */
export function placeCandidates(entities: readonly QlooEntity[], evidenceId: string, seedNames: ReadonlyMap<string, string>): { kept: CultureCandidate[]; chains: string[] } {
  const counts = new Map<string, number>();
  for (const entity of entities) counts.set(entity.name.trim().toLowerCase(), (counts.get(entity.name.trim().toLowerCase()) ?? 0) + 1);
  const chains = [...counts].filter(([, n]) => n > 1).map(([name]) => entities.find((e) => e.name.trim().toLowerCase() === name)!.name);
  const kept: CultureCandidate[] = [];
  for (const entity of entities) {
    if ((counts.get(entity.name.trim().toLowerCase()) ?? 0) > 1 || guarded(entity.name)) continue;
    kept.push({
      kind: "entity",
      id: entity.id,
      name: entity.name,
      type: entity.type ?? "urn:entity:place",
      field: "setting",
      rank: kept.length + 1,
      position: null,
      why: placeWhy(entity, seedNames),
      details: detailsOf({ ...entity, type: "urn:entity:place" }),
      evidenceIds: [evidenceId],
    });
  }
  return { kept, chains };
}

/**
 * The world's setting city: among the audience's stable headline cities (Prove's top 5 without
 * flags, the ones the Reality Check names), the one this world's own heatmap lifts most, skipping
 * cities other worlds already use; the rest of the top 10 only when the headline cities are taken.
 */
export interface SettingCityChoice {
  label: string;
  metro: (typeof METROS)[number];
  audienceRank: number;
  lift: MetroLift | null;
}

export function pickSettingCity(
  proof: Proof,
  segmentCells: readonly HeatmapCell[],
  reference: ReferenceSets,
  options: { exclude?: readonly HeatmapCell[]; used?: ReadonlySet<string> } = {},
): SettingCityChoice | null {
  // The headline cities first (the top 5 the Reality Check names), then the rest of the top 10.
  const open = proof.cityRanks.filter((c) => c.flags.length === 0 && !options.used?.has(c.label));
  const headline = open.filter((c) => c.rank <= TOP_CITIES);
  const stable = headline.length > 0 ? headline : open;
  if (stable.length === 0) return null;
  const lifts = new Map(liftByMetro(segmentCells, reference.full.cells, options.exclude ? { exclude: options.exclude } : {}).map((m) => [m.metro.name, m]));
  const ranked = [...stable].sort((a, b) => (lifts.get(b.metro)?.score ?? -Infinity) - (lifts.get(a.metro)?.score ?? -Infinity) || a.rank - b.rank);
  const best = ranked[0];
  const metro = METROS.find((m) => m.name === best.metro);
  if (!metro) return null;
  return { label: best.label, metro, audienceRank: best.rank, lift: lifts.get(best.metro) ?? null };
}

export interface WorldSweep {
  settingCity: SettingCity | null;
  /** Films, shows and places for this world (artists and brands come from Segments). */
  candidates: CultureCandidate[];
  /** The anchor the place call used, so the agent's place probes use the same one. */
  anchor: PlaceAnchor | null;
  /** Chains left out of the places, so the agent's probes leave them out too. */
  chains: string[];
}

/**
 * Every world's setting city, chosen in segment order before the worlds run side by side, so two
 * worlds never claim the same city. Pure: no calls.
 */
export function chooseSettingCities(
  proof: Proof,
  worlds: readonly { segmentId: string; cells: readonly HeatmapCell[] }[],
  reference: ReferenceSets,
  options: { exclude?: readonly HeatmapCell[] } = {},
): Map<string, SettingCityChoice | null> {
  const used = new Set<string>();
  const chosen = new Map<string, SettingCityChoice | null>();
  for (const world of worlds) {
    const city = pickSettingCity(proof, world.cells, reference, { ...options, used });
    if (city) used.add(city.label);
    chosen.set(world.segmentId, city);
  }
  return chosen;
}

/** One world's sweep: its setting city's locality, then films, shows and places. */
export async function sweepWorld(
  env: StageEnv,
  input: { seeds: readonly Seed[]; bucket: AgeBucket; proof: Proof; city: SettingCityChoice | null },
): Promise<WorldSweep> {
  const band = ageBandLabel(input.bucket);
  const { city } = input;
  let settingCity: SettingCity | null = null;
  let anchor: PlaceAnchor | null = null;
  if (city) {
    const { city: name } = localityName(city.metro);
    const found = await qloo(env, "culture", `Looking up ${city.label} as a Qloo locality`, {
      endpoint: ENDPOINTS.search,
      params: localityParams(name),
      schema: searchResponse,
      slim: slimEntitiesBody,
      onNotFound: [],
      budgetRow: "localities",
    });
    const locality = acceptLocality(found.data, city.metro);
    if (locality) {
      anchor = { "filter.location": locality.id };
      const proofEvidence = input.proof.cities.find((c) => c.label === city.label)?.evidenceIds ?? [];
      settingCity = { label: city.label, localityId: locality.id, audienceRank: city.audienceRank, evidenceIds: [...new Set([...proofEvidence, found.evidence.id])] };
      decide(env, "culture", `Set this world in ${city.label}`, `One of the audience's stable top cities (#${city.audienceRank}), and the one ${band} lifts most.`);
    } else if (city.lift) {
      anchor = placeAnchor(city.lift);
      decide(env, "culture", `Anchored ${city.label}'s places on its urban core`, "Qloo has no locality with that city's name in that state, so places run within 20 km of the metro's densest cell.");
    } else {
      decide(env, "culture", `No place query for ${city.label}`, "Qloo has no matching locality and this world's heatmap has no cell there to anchor on.");
    }
  } else {
    decide(env, "culture", "No setting city for this world", "The audience has no stable top city left; settings stay without a place query.");
  }

  const requests = cultureRequests(input.seeds, input.bucket, anchor);
  const [movies, shows] = await Promise.all([
    qloo(env, "culture", `Finding the films ${band} in this audience love`, { endpoint: ENDPOINTS.insights, params: requests.movie, schema: insightsEntitiesResponse, slim: slimEntitiesBody }),
    qloo(env, "culture", `Finding the TV shows ${band} in this audience love`, { endpoint: ENDPOINTS.insights, params: requests.tv_show, schema: insightsEntitiesResponse, slim: slimEntitiesBody }),
  ]);
  const candidates = [...entityCandidates(movies.data, "visual", movies.evidence.id), ...entityCandidates(shows.data, "visual", shows.evidence.id)];
  const left: string[] = [];

  if (requests.place && city) {
    const places = await qloo(env, "culture", `Finding everyday places ${band} in this audience love in ${city.label}`, {
      endpoint: ENDPOINTS.insights,
      params: requests.place,
      schema: insightsEntitiesResponse,
      slim: slimEntitiesBody,
    });
    const seedNames = new Map(input.seeds.map((s) => [s.ref.id, s.ref.name]));
    const { kept, chains } = placeCandidates(places.data, places.evidence.id, seedNames);
    if (chains.length) decide(env, "culture", `Left out ${chains.length === 1 ? "a chain" : `${chains.length} chains`} from the places`, `${chains.join(", ")} came back more than once, so ${chains.length === 1 ? "it says" : "they say"} nothing about this city.`);
    candidates.push(...kept);
    left.push(...chains);
  }
  return { settingCity, candidates, anchor, chains: left };
}

/** The run's creators: people and podcasts the whole taste neighborhood follows (scope "audience"). */
export async function sweepCreators(env: StageEnv, seeds: readonly Seed[]): Promise<CultureCandidate[]> {
  const requests = creatorRequests(seeds);
  const [people, podcasts] = await Promise.all([
    qloo(env, "culture", "Finding the people this audience follows", { endpoint: ENDPOINTS.insights, params: requests.person, schema: insightsEntitiesResponse, slim: slimEntitiesBody }),
    qloo(env, "culture", "Finding the podcasts this audience listens to", { endpoint: ENDPOINTS.insights, params: requests.podcast, schema: insightsEntitiesResponse, slim: slimEntitiesBody }),
  ]);
  return [...entityCandidates(people.data, "creators", people.evidence.id), ...entityCandidates(podcasts.data, "creators", podcasts.evidence.id)];
}

/**
 * Brands Qloo files under something people wear (its own brand genre tags), the only brands that can
 * back wardrobe. A kitchen appliance or a deli brand says something about the audience, not about
 * what anyone on screen wears.
 */
export const WEARABLE_BRAND_GENRES: ReadonlySet<string> = new Set(
  ["Fashion", "Casual", "Lifestyle / Casual", "Accessories", "Athletic", "Footwear", "Sneakers", "Jewelry", "Watch", "Eyewear", "Formalwear", "Bags & Leather", "Haute Couture", "High-end / Designer", "Jeans", "Swimwear", "Outerwear", "Apparel", "Clothing"].map((g) => g.toLowerCase()),
);

export const isWearable = (brand: QlooEntity) =>
  brand.tags.some((tag) => tag.type === "urn:tag:genre:brand" && WEARABLE_BRAND_GENRES.has(tag.name.trim().toLowerCase()));

/**
 * Artists, wearable brands and Prove's tags as candidates, from what Segments and Prove already
 * measured (with Qloo's properties from Segments' own responses). Wardrobe draws on the segment's
 * top wearable brands in Qloo's order, which can reach past the top 10 brands the report lists.
 */
export function measuredCandidates(segment: Pick<Segment, "artists">, raw: Pick<SegmentRaw, "artists" | "brands" | "evidence">, proof: Proof): CultureCandidate[] {
  const artists: CultureCandidate[] = segment.artists.map((ref: EntityRef) => {
    const entity = raw.artists.find((e) => e.id === ref.id);
    return { kind: "entity", id: ref.id, name: ref.name, type: ref.type, field: "music", rank: ref.rank, position: null, why: [], details: entity ? detailsOf(entity) : [], evidenceIds: ref.evidenceIds };
  });
  return [
    ...artists,
    // Qloo's own rank among all the segment's brands, not among the wearable ones.
    ...entityCandidates(raw.brands.filter(isWearable), "wardrobe", raw.evidence.brands, TOP_PICKS, (brand) => raw.brands.indexOf(brand) + 1),
    ...tagCandidates(proof.tags.filter((t) => t.kind === "music"), "music", "urn:tag:genre:music"),
    ...tagCandidates(proof.tags.filter((t) => t.kind === "tone"), "mood", "urn:tag:emotional_tone:qloo"),
  ];
}

