// The city and the block: the two things Qloo decides for a store (docs/store-events-memo.md). The
// city is read by name (its artists and music styles for the store's adult age bands); the block is
// the places within a radius of the store, one category per call. Anything Qloo has no signal for is
// said plainly as a gap, never filled in.
import { ENDPOINTS } from "../qloo/constants";
import { QlooBudgetError, QlooConfigError, QlooHttpError, QlooShapeError } from "../qloo/errors";
import { insightsEntitiesResponse, insightsTagsResponse, slimEntitiesBody } from "../qloo/types";
import { planDecide, planQloo, type PlanEnv } from "./env";
import { blockParams, cityArtistsParams, cityStylesParams, DEFAULT_RADIUS_M, placesResponse } from "./requests";
import type { Block, CityTaste, Place, PlanInputs } from "./schema";
import { BLOCK_CATEGORIES, BLOCK_ORDER, identityTag, isChain, musicStyles, placeLeftOut, toArtists, toPlace, type BlockCategory } from "./taste";

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

/** The city's artists and music styles, by city name and the store's age bands. Two calls. */
export async function readCity(env: PlanEnv, inputs: PlanInputs): Promise<CityTaste | null> {
  const city = inputs.store.city;
  let artistsEntities: Awaited<ReturnType<typeof fetchArtists>> | null = null;
  try {
    artistsEntities = await fetchArtists(env, inputs);
  } catch (error) {
    if (!recoverable(error)) throw error;
    env.sink.emit({ type: "local.gap", text: gapText(error, `${city}'s artists`) });
  }
  let tags: Awaited<ReturnType<typeof fetchStyles>> | null = null;
  try {
    tags = await fetchStyles(env, inputs);
  } catch (error) {
    if (!recoverable(error)) throw error;
    env.sink.emit({ type: "local.gap", text: gapText(error, `${city}'s music styles`) });
  }
  if (!artistsEntities && !tags) return null;

  const artists = artistsEntities ? toArtists(artistsEntities.data, artistsEntities.evidence.id) : [];
  if (artists.length === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${city}'s artists at these ages` });
  const { styles, dropped } = musicStyles({
    city,
    cityTags: tags?.data ?? [],
    cityTagsEvidenceId: tags?.evidence.id ?? "",
    artistEntities: artistsEntities?.data ?? [],
    artistsEvidenceId: artistsEntities?.evidence.id ?? "",
  });
  // A style can cite only calls that answered.
  const answered = new Set([artistsEntities?.evidence.id, tags?.evidence.id].filter((id): id is string => !!id));
  const cited = styles.map((s) => ({ ...s, evidenceIds: s.evidenceIds.filter((id) => answered.has(id)) })).filter((s) => s.evidenceIds.length > 0);
  const identity = dropped.filter((d) => identityTag(d.name));
  if (identity.length) planDecide(env, "city", `Left out ${identity.length} identity ${identity.length === 1 ? "tag" : "tags"}`, `${identity.map((d) => `"${d.name}"`).slice(0, 6).join(", ")}: each describes who people are, not what they listen to. Stoop reads taste, never identity.`);
  const noisy = dropped.filter((d) => !identityTag(d.name));
  if (noisy.length) planDecide(env, "city", `Left out ${noisy.length} noisy music ${noisy.length === 1 ? "tag" : "tags"}`, `${noisy.map((d) => `"${d.name}"`).slice(0, 8).join(", ")}${noisy.length > 8 ? " and more" : ""}: not a style to play, or none of the city's top artists play it.`);
  if (cited.length === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${city}'s music styles at these ages` });
  else planDecide(env, "city", `Kept ${cited.length} music styles for ${city}`, "From the genres the city's top artists share; a city tag joins only when it agrees with them.");
  return { city, ageBands: [...inputs.ageBands], artists, styles: cited };
}

function fetchArtists(env: PlanEnv, inputs: PlanInputs) {
  return planQloo(env, "city", `Asking Qloo which artists adults ${agesText(inputs)} in ${inputs.store.city} love`, {
    endpoint: ENDPOINTS.insights,
    params: cityArtistsParams(inputs),
    schema: insightsEntitiesResponse,
    slim: slimEntitiesBody,
  }, "By city name: a map point barely changes taste, so the city is the signal.");
}

function fetchStyles(env: PlanEnv, inputs: PlanInputs) {
  return planQloo(env, "city", `Reading the music styles adults ${agesText(inputs)} in ${inputs.store.city} lean toward`, {
    endpoint: ENDPOINTS.insights,
    params: cityStylesParams(inputs),
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
      places.push(toPlace(entity, { rank: index + 1, evidenceId: result.evidence.id, fallback: spec.kind }));
      kept++;
    });
    if (kept === 0) env.sink.emit({ type: "local.gap", text: `No Qloo signal for ${spec.label} within ${km(radiusM)} of ${inputs.location ? inputs.location.name : "this store"}` });
  }
  if (leftOut.length > 0) planDecide(env, "block", `Left ${leftOut.length} ${leftOut.length === 1 ? "place" : "places"} off the block`, leftOut.slice(0, 6).join("; "));
  const chains = places.filter((p) => isChain(p.name));
  if (chains.length > 0) planDecide(env, "block", `Marked ${chains.length} national ${chains.length === 1 ? "chain" : "chains"}`, `${chains.map((p) => p.name).slice(0, 5).join(", ")}: fine for a gift card or a snack run; co-promo partners are local independents.`);
  if (answered === 0) return null;
  planDecide(env, "block", `Kept ${places.length} places near ${where}`, "Every one has a Qloo receipt: partners, gift cards and snack runs come from this list.");
  return { radiusM, places };
}
