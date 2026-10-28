// The city and the block: the two things Qloo decides for a store (docs/store-events-memo.md). The
// city is read by name (its artists and music styles for the store's adult age bands); the block is
// the places within a radius of the store, one category per call. Anything Qloo has no signal for is
// said plainly as a gap, never filled in.
import { ENDPOINTS } from "../qloo/constants";
import { QlooBudgetError, QlooConfigError, QlooHttpError, QlooShapeError } from "../qloo/errors";
import type { QlooResult } from "../qloo/client";
import { insightsTagsResponse, slimEntitiesBody, type QlooEntity } from "../qloo/types";
import { artistsWithLocality, cityQueries, localityMiss, nearestMajorCity, stateOf, type Locality } from "./locality";
import { planDecide, planQloo, type PlanEnv } from "./env";
import { blockParams, cityArtistsParams, cityStylesParams, DEFAULT_RADIUS_M, placesResponse } from "./requests";
import type { Block, CityTaste, Place, PlanInputs } from "./schema";
import { BLOCK_CATEGORIES, BLOCK_ORDER, identityTag, musicStyles, placeLeftOut, toArtists, toPlace, type BlockCategory } from "./taste";

/** Places kept per category, so one category cannot crowd out the rest of the plan's prompt. */
export const MAX_PLACES_PER_CATEGORY = { food: 10, treats: 6, venues: 6, parks: 4 } as const satisfies Record<BlockCategory, number>;

export const ageLabel = (band: string) => (band === "24_and_younger" ? "18 to 24" : band.replace("_and_older", " and older").replace(/_to_/, " to "));
const agesText = (inputs: PlanInputs) => inputs.ageBands.map(ageLabel).join(", ");

/** A Qloo failure a stage can live with: it becomes a gap and the plan goes on with what arrived. */
export function recoverable(error: unknown): boolean {
  return error instanceof QlooHttpError || error instanceof QlooShapeError || error instanceof QlooBudgetError;
}

export function gapText(error: unknown, what: string): string {
  if (error instanceof QlooConfigError) throw error;
  if (error instanceof QlooBudgetError) return `No Qloo signal for ${what}: this run's Qloo budget was spent`;
  return `No Qloo signal for ${what}: Qloo did not answer`;
}

export interface CityRead {
  taste: CityTaste | null;
  /** The name Qloo read the city's taste by ("Jonesboro, GA"), for every later city-signal call. */
  query: string;
}

type ArtistsResult = QlooResult<{ entities: QlooEntity[]; locality: Locality | null }>;

/**
 * Finds the name Qloo reads in the store's own state. Each try is the city-artists call itself, so a
 * name that resolves right costs nothing extra: the bare city, "<city>, <region>", "<city>, <state>",
 * then the nearest major city in the state (said plainly as a gap). When Qloo sends no locality, the
 * answer is used as is. Up to four calls; usually one.
 */
async function resolveCity(env: PlanEnv, inputs: PlanInputs): Promise<{ query: string; result: ArtistsResult } | null> {
  const { city, region } = inputs.store;
  const state = stateOf(region);
  const tries = cityQueries(city, region);
  let first: { query: string; result: ArtistsResult } | null = null;
  const missed: string[] = [];
  for (const [i, query] of tries.entries()) {
    let result: ArtistsResult;
    try {
      result = await fetchArtists(env, inputs, query, i === 0 ? "planCity" : "planLocate");
    } catch (error) {
      if (!recoverable(error)) throw error;
      if (i === 0) env.sink.emit({ type: "local.gap", text: gapText(error, `${city}'s artists`) });
      break;
    }
    first ??= { query, result };
    const locality = result.data.locality;
    const miss = localityMiss(locality, result.data.entities.length, inputs.store, state?.name ?? null);
    if (!miss) {
      if (i > 0) planDecide(env, "city", `Read the city as "${query}"`, `Qloo read ${missed.join(" and ")}; "${query}" is ${locality?.disambiguation ?? locality?.name ?? query}.`);
      return { query, result };
    }
    missed.push(`"${query}" as ${miss}`);
  }
  if (!first) return null;
  const major = state ? nearestMajorCity(state.abbr, inputs.store.point) : null;
  if (state && major) {
    const query = `${major.name}, ${state.abbr}`;
    try {
      const result = await fetchArtists(env, inputs, query, "planLocate");
      // The nearest major city may itself sit farther than the limit from a rural store, so only its state and its artists are checked.
      if (!localityMiss(result.data.locality ? { ...result.data.locality, point: null } : null, result.data.entities.length, inputs.store, state.name)) {
        env.sink.emit({ type: "local.gap", text: `Qloo did not read ${city} as this store's city (it read ${missed.join("; ")}), so the city's taste is read from ${major.name}, the nearest major city in ${state.name} (${major.km} km)` });
        return { query, result };
      }
    } catch (error) {
      if (!recoverable(error)) throw error;
    }
  }
  env.sink.emit({ type: "local.gap", text: `Qloo could not place ${city} near this store; its taste below is for ${first.result.data.locality?.disambiguation ?? first.query}` });
  return first;
}

/** The city's artists and music styles, by city name (checked against the store's state) and the store's age bands. */
export async function readCity(env: PlanEnv, inputs: PlanInputs): Promise<CityRead> {
  const resolved = await resolveCity(env, inputs);
  const query = resolved?.query ?? inputs.store.city;
  const city = resolved?.result.data.locality?.name ?? inputs.store.city;
  let tags: Awaited<ReturnType<typeof fetchStyles>> | null = null;
  try {
    tags = await fetchStyles(env, inputs, query);
  } catch (error) {
    if (!recoverable(error)) throw error;
    env.sink.emit({ type: "local.gap", text: gapText(error, `${city}'s music styles`) });
  }
  if (!resolved && !tags) return { taste: null, query };

  const artistsEvidence = resolved?.result.evidence.id ?? "";
  const artistEntities = resolved?.result.data.entities ?? [];
  const artists = resolved ? toArtists(artistEntities, artistsEvidence) : [];
  if (artists.length === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${city}'s artists at these ages` });
  const { styles, dropped } = musicStyles({ city, cityTags: tags?.data ?? [], cityTagsEvidenceId: tags?.evidence.id ?? "", artistEntities, artistsEvidenceId: artistsEvidence });
  // A style can cite only calls that answered.
  const answered = new Set([resolved?.result.evidence.id, tags?.evidence.id].filter((id): id is string => !!id));
  const cited = styles.map((s) => ({ ...s, evidenceIds: s.evidenceIds.filter((id) => answered.has(id)) })).filter((s) => s.evidenceIds.length > 0);
  const identity = dropped.filter((d) => identityTag(d.name));
  if (identity.length) planDecide(env, "city", `Left out ${identity.length} identity ${identity.length === 1 ? "tag" : "tags"}`, "Each describes who people are, not what they listen to. Stoop reads taste, never identity.");
  const noisy = dropped.filter((d) => !identityTag(d.name));
  if (noisy.length) planDecide(env, "city", `Left out ${noisy.length} noisy music ${noisy.length === 1 ? "tag" : "tags"}`, "Each is not a style to play (a place, an instrument, a novelty word), or none of the city's top artists play it.");
  if (cited.length === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${city}'s music styles at these ages` });
  else planDecide(env, "city", `Kept ${cited.length} music styles for ${city}`, "From the genres the city's top artists share, plus any broad style the city's own list carries; other city tags join only when the artists agree.");
  return { taste: { city, ageBands: [...inputs.ageBands], artists, styles: cited }, query };
}

function fetchArtists(env: PlanEnv, inputs: PlanInputs, query: string, budgetRow: "planCity" | "planLocate"): Promise<ArtistsResult> {
  return planQloo(env, "city", `Asking Qloo which artists adults ${agesText(inputs)} in ${query} love`, {
    endpoint: ENDPOINTS.insights,
    params: cityArtistsParams(inputs, query),
    schema: artistsWithLocality,
    slim: slimEntitiesBody,
    budgetRow,
  }, "By city name: a map point barely changes taste, so the city is the signal. The place Qloo reads is checked against the store's state.");
}

function fetchStyles(env: PlanEnv, inputs: PlanInputs, query: string) {
  return planQloo(env, "city", `Reading the music styles adults ${agesText(inputs)} in ${query} lean toward`, {
    endpoint: ENDPOINTS.insights,
    params: cityStylesParams(inputs, query),
    schema: insightsTagsResponse,
  });
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, "")} km` : `${m} m`);

/** Places near the store, one call per category, local independents only. Four calls. */
export async function readBlock(env: PlanEnv, inputs: PlanInputs, radiusM: number = DEFAULT_RADIUS_M): Promise<Block | null> {
  const places: Place[] = [];
  let answered = 0;
  const leftOut: string[] = [];
  const where = inputs.location ? inputs.location.name : "the store";
  for (const category of BLOCK_ORDER) {
    const spec = BLOCK_CATEGORIES[category];
    let result;
    try {
      result = await planQloo(env, "block", `Finding ${spec.label} within ${km(radiusM)} of ${where}`, {
        endpoint: ENDPOINTS.insights,
        params: blockParams(inputs, category, radiusM),
        schema: placesResponse,
        slim: slimEntitiesBody,
      });
    } catch (error) {
      if (!recoverable(error)) throw error;
      env.sink.emit({ type: "local.gap", text: gapText(error, `${spec.label} near this store`) });
      continue;
    }
    answered++;
    let kept = 0;
    result.data.forEach((entity, index) => {
      if (kept >= MAX_PLACES_PER_CATEGORY[category] || places.some((p) => p.id === entity.id)) return;
      const why = placeLeftOut(entity);
      if (why) {
        if (!leftOut.some((line) => line.startsWith(entity.name))) leftOut.push(`${entity.name} (${why})`);
        return;
      }
      places.push(toPlace(entity, { rank: index + 1, evidenceId: result.evidence.id, fallback: spec.kind, ...(env.knownChains ? { knownChains: env.knownChains } : {}) }));
      kept++;
    });
    if (kept === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${spec.label} within ${km(radiusM)} of ${inputs.location ? inputs.location.name : "this store"}` });
  }
  if (leftOut.length > 0) planDecide(env, "block", `Left ${leftOut.length} ${leftOut.length === 1 ? "place" : "places"} off the block`, leftOut.slice(0, 6).join("; "));
  const chains = places.filter((p) => p.chain);
  if (chains.length > 0) planDecide(env, "block", `Marked ${chains.length} national ${chains.length === 1 ? "chain" : "chains"}`, `${chains.map((p) => p.name).slice(0, 5).join(", ")}: fine for a gift card or a snack run; co-promo partners are local independents.`);
  if (answered === 0) return null;
  planDecide(env, "block", `Kept ${places.length} places near ${where}`, "Every one has a Qloo receipt: partners, gift cards and snack runs come from this list.");
  return { radiusM, places };
}
