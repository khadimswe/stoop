// Music from the block, as a tested option. The city's music is read by city name, which for a metro
// is one list across many towns. This asks Qloo once which artists people who love the block's own
// top independent places play (signal.interests.entities, with explainability). Place signals can
// return dated or generic category profiles (the barbershop test, Oct 28), so the answer is offered
// only when it is current and adds artists the city's list lacks, and always next to the city's
// music, never instead of it: "People who love [[place]] also play [[artist]]".
import { ENDPOINTS } from "../qloo/constants";
import { insightsEntitiesResponse, slimEntitiesBody, type QlooEntity } from "../qloo/types";
import { planDecide, planQloo, type PlanEnv } from "./env";
import { gapText, recoverable } from "./local";
import type { Block, BlockMusic, CityTaste, PlanInputs } from "./schema";
import { tagSimilarity } from "../qloo/match";
import { artistGenres, toArtists } from "./taste";

/** Independent places used as the signal. */
export const SIGNAL_PLACES = 3;
export const BLOCK_MUSIC_TAKE = 15;
export const MAX_BLOCK_ARTISTS = 8;
/** Below this median start year an answer that sounds like the city's list reads as a dated category profile. */
export const DATED_BEFORE = 2005;
/** Below this median start year any answer is too dated to offer. */
export const OLDEST = 1995;
/** At or above this share of its top 10 already on the city's list, it adds nothing. */
export const REPEATS_AT = 0.7;

export function blockMusicParams(inputs: PlanInputs, placeIds: readonly string[]) {
  return {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": [...placeIds],
    "signal.demographics.age": [...inputs.ageBands],
    "feature.explainability": true,
    take: BLOCK_MUSIC_TAKE,
  } as const;
}

/** The block's top independents: food, treats and venues in Qloo's order, no chains and no parks. */
export function signalPlaces(block: Block): string[] {
  return block.places.filter((p) => !p.chain && p.kind !== "park").slice(0, SIGNAL_PLACES).map((p) => p.id);
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const startYear = (entity: QlooEntity): number | null => {
  const value = entity.properties?.start_year;
  const year = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(year) && year > 1900 ? year : null;
};

/** The city's own sound: the styles it was given (its main genres), or its top three artists' genres without them. */
const citySound = (city: CityTaste | null) => (city?.styles.length ? city.styles.map((s) => s.name) : (city?.artists.slice(0, 3).flatMap((a) => a.genres) ?? []));

/** True when none of an artist's genres sounds like the city's list. */
const newSound = (entity: QlooEntity, sound: readonly string[]) => {
  const genres = artistGenres(entity);
  return genres.length > 0 && !genres.some((g) => sound.some((c) => tagSimilarity(g, c) >= 0.5));
};

/**
 * Whether the answer is worth offering, and why. Place signals can return a category profile: the
 * same older artists for any place of a kind (the barbershop test). So it is offered when it brings a
 * sound the city's list lacks (half its top 10 or more, and not older than DATED_BEFORE by much), or
 * when it is current and mostly new artists; it is left out when it is dated or repeats the city.
 */
export function judgeBlockMusic(entities: readonly QlooEntity[], city: CityTaste | null): { used: boolean; reason: string } {
  const top = entities.slice(0, 10);
  if (top.length < 3) return { used: false, reason: "Qloo returned too few artists for the block's places." };
  const years = top.map(startYear).filter((y): y is number => y !== null);
  const mid = years.length >= 3 ? Math.round(median(years)) : null;
  if (mid !== null && mid < OLDEST) return { used: false, reason: `Its artists are dated (median start year ${mid}): place signals can return old category profiles.` };
  const cityIds = new Set(city?.artists.map((a) => a.id) ?? []);
  const repeats = top.filter((e) => cityIds.has(e.id)).length;
  if (repeats / top.length >= REPEATS_AT) return { used: false, reason: `It mostly repeats the city's own list (${repeats} of ${top.length}).` };
  const sound = citySound(city);
  const fresh = top.filter((e) => newSound(e, sound));
  if (sound.length && fresh.length * 2 >= top.length) {
    const genres = [...new Set(fresh.flatMap((e) => artistGenres(e).slice(0, 1)))].slice(0, 2);
    return { used: true, reason: `It brings a sound the city's list lacks${genres.length ? ` (${genres.join(", ")})` : ""}: ${fresh.length} of ${top.length} of its artists${mid !== null ? `, median start year ${mid}` : ""}.` };
  }
  if (mid !== null && mid < DATED_BEFORE) return { used: false, reason: `Its artists are mostly dated (median start year ${mid}) and sound like the city's list: a category profile, not this block.` };
  return { used: true, reason: `Current artists${mid !== null ? ` (median start year ${mid})` : ""}, ${top.length - repeats} of ${top.length} not on the city's list.` };
}

/** One call. Null when the block has no independents to signal with, or Qloo did not answer. */
export async function readBlockMusic(env: PlanEnv, inputs: PlanInputs, block: Block | null, city: CityTaste | null): Promise<BlockMusic | null> {
  if (!block) return null;
  const placeIds = signalPlaces(block);
  if (placeIds.length === 0) return null;
  const names = new Map(block.places.map((p) => [p.id, p.name]));
  let result;
  try {
    result = await planQloo(env, "block", `Asking Qloo what people who love ${placeIds.map((id) => names.get(id)).join(", ")} play`, {
      endpoint: ENDPOINTS.insights,
      params: blockMusicParams(inputs, placeIds),
      schema: insightsEntitiesResponse,
      slim: slimEntitiesBody,
      budgetRow: "planBlockMusic",
    }, "The block's own independents as the signal: a test of block music next to the city's, never instead of it.");
  } catch (error) {
    if (!recoverable(error)) throw error;
    env.sink.emit({ type: "local.gap", text: gapText(error, "music from the block's places") });
    return null;
  }
  const verdict = judgeBlockMusic(result.data, city);
  const cityIds = new Set(city?.artists.map((a) => a.id) ?? []);
  // Each artist with the signal places Qloo's explainability links it to most.
  // Only artists the city's list lacks: the option adds something, and every artist keeps one key.
  const ordered = result.data.filter((e) => !cityIds.has(e.id));
  const artists = toArtists(ordered, result.evidence.id).slice(0, MAX_BLOCK_ARTISTS).map((artist) => {
    const entity = result.data.find((e) => e.id === artist.id);
    const scores = Object.values(entity?.explainability ?? {}).flat().filter((x) => placeIds.includes(x.entityId));
    const best = Math.max(0, ...scores.map((x) => x.score));
    const via = scores.length ? [...new Set(scores.filter((x) => x.score >= best * 0.9).map((x) => x.entityId))] : placeIds;
    return { ...artist, via };
  });
  planDecide(env, "block", verdict.used ? "Offering music from the block's own places" : "Left the block's music out", verdict.reason);
  return { placeIds, artists, used: verdict.used && artists.length > 0, reason: verdict.reason };
}
