// Segments: up to two measured worlds, one per over-indexing age bucket. Each gets its own artist
// and brand affinities (the same params Gate 4's Culture stage sends, so they are cached there) and
// its own heatmap. Two worlds that share most of their tastes merge into one, as a decision. Labels
// are built only from what Qloo measured: the age band and the top artists' most common genres (a
// Qloo property). Every segment is adult.
//
// Segment cities carry an age effect: the reference audiences have no age signal, so a segment's
// ranking also reflects where that age band lives in general (18 to 24 lands in college towns such
// as St. Cloud and Ames). They are kept as data for Gate 4's settings, with that caveat, and are not
// in the label; the Reality Check uses the audience-level cities, which compare like with like.
import { checkText } from "../guardrails";
import { rankCities, shortMetroName } from "../geo/metros";
import { ENDPOINTS, type AgeBucket } from "../qloo/constants";
import { heatmapResponse, insightsEntitiesResponse, slimEntitiesBody, slimHeatmapBody, type HeatmapCell, type QlooEntity } from "../qloo/types";
import type { CityCue, EntityRef, Proof, Seed, Segment, Segments } from "../report/schema";
import { ageBandLabel } from "../types";
import { decide, qloo, type StageEnv } from "./env";
import { pickSegmentBuckets, topOverlap } from "./measure";
import { seedSignal } from "./prove";

/** Below this distinctness (1 minus the top-20 overlap) two segments are one world and merge. */
export const MERGE_BELOW = 0.3;
export const SEGMENT_CITIES = 3;
export const TOP_ENTITIES = 10;

export const segmentIdFor = (bucket: AgeBucket) => `seg-${bucket.replace(/_/g, "-")}`;

/** A segment's three requests, exported so recordings can be planned from the same params. */
export function segmentRequestsFor(seeds: readonly Seed[], bucket: AgeBucket, region: string) {
  const signal = { ...seedSignal(seeds), "signal.demographics.age": [bucket] };
  return {
    artist: { ...signal, "filter.type": "urn:entity:artist", take: 50 },
    brand: { ...signal, "filter.type": "urn:entity:brand", take: 50 },
    heatmap: { ...signal, "filter.type": "urn:heatmap", "filter.location.query": region },
  };
}

/** Names that appear in the report pass the minor and ethnicity guardrails, like every other string. */
const shown = (e: QlooEntity) => checkText(e.name).every((issue) => issue.rule !== "minor" && issue.rule !== "ethnicity");

const refs = (entities: readonly QlooEntity[], evidenceId: string): EntityRef[] =>
  entities.filter(shown).slice(0, TOP_ENTITIES).map((e, i) => ({
    id: e.id,
    name: e.name,
    type: e.type ?? "urn:entity",
    rank: i + 1,
    affinity: e.affinity,
    popularity: e.popularity,
    evidenceIds: [evidenceId],
  }));

/** How many of the top artists list each primary genre (Qloo's own artist property), guardrailed. */
export function genreCounts(artists: readonly QlooEntity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const artist of artists.slice(0, TOP_ENTITIES)) {
    const genres = artist.properties?.primary_genres;
    if (!Array.isArray(genres)) continue;
    for (const genre of new Set(genres.filter((g): g is string => typeof g === "string").map((g) => g.trim().toLowerCase()))) {
      if (checkText(genre).some((issue) => issue.rule === "minor" || issue.rule === "ethnicity")) continue;
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The genres that name a segment: the most common ones, or, next to another segment, the ones most
 * distinctive to it (its count minus the other's), so two different worlds never share a label.
 */
export function topGenres(artists: readonly QlooEntity[], other?: readonly QlooEntity[], n = 2): string[] {
  const mine = genreCounts(artists);
  const theirs = other ? genreCounts(other) : new Map<string, number>();
  return [...mine]
    .map(([genre, count]) => ({ genre, count, edge: count - (theirs.get(genre) ?? 0) }))
    .sort((a, b) => b.edge - a.edge || b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, n)
    .map((g) => g.genre);
}

export function segmentLabel(bucket: AgeBucket, genres: readonly string[]): string {
  return [ageBandLabel(bucket), genres.length ? genres.join(" and ") : null].filter(Boolean).join(" · ");
}

/** Two segments this similar are one world. */
export const shouldMerge = (distinctness: number) => distinctness < MERGE_BELOW;

/** What Segments measured beyond the report: each segment's full responses, for Culture's settings and craft. */
export interface SegmentRaw {
  artists: QlooEntity[];
  brands: QlooEntity[];
  heatmap: HeatmapCell[];
  /** The receipt behind each response. */
  evidence: { artists: string; brands: string; heatmap: string };
}

/**
 * `parentHeatmap` is Prove's heatmap for the whole audience. A segment shares much of its parent's
 * signal, so the parent is left out of the reference mean when ranking the segment's cities.
 */
export async function segments(
  env: StageEnv,
  input: { seeds: readonly Seed[]; proof: Proof; region: string; parentHeatmap: readonly HeatmapCell[] },
): Promise<{ segments: Segments; raw: Map<string, SegmentRaw> }> {
  const raw = new Map<string, SegmentRaw>();
  const buckets = pickSegmentBuckets(input.proof.demographics.age);
  if (buckets.length === 1) {
    decide(env, "segments", `One measured segment: ${ageBandLabel(buckets[0])}`, "No other age band over-indexes, so there is no second world to build.");
  }
  const built: Segment[] = [];
  // Full id lists (not just the top 10 shown) for the distinctness check.
  const lists: { artists: string[]; brands: string[] }[] = [];
  const rawArtists: QlooEntity[][] = [];
  for (const bucket of buckets) {
    const band = ageBandLabel(bucket);
    const requests = segmentRequestsFor(input.seeds, bucket, input.region);
    const artists = await qloo(env, "segments", `Finding the artists ${band} in this audience love`, {
      endpoint: ENDPOINTS.insights,
      params: requests.artist,
      schema: insightsEntitiesResponse,
      slim: slimEntitiesBody,
    });
    const brands = await qloo(env, "segments", `Finding the brands ${band} in this audience love`, {
      endpoint: ENDPOINTS.insights,
      params: requests.brand,
      schema: insightsEntitiesResponse,
      slim: slimEntitiesBody,
    });
    const heatmap = await qloo(env, "segments", `Mapping where ${band} in this audience cluster`, {
      endpoint: ENDPOINTS.insights,
      params: requests.heatmap,
      schema: heatmapResponse,
      slim: slimHeatmapBody,
    });
    // The segment's heatmap is not a reference audience; its parent (when it is one) is left out.
    const { cities: ranked } = rankCities(heatmap.data, env.reference, env.inReference ? { exclude: input.parentHeatmap } : {});
    const cities: CityCue[] = ranked.slice(0, SEGMENT_CITIES).map((m) => ({
      metro: m.metro.name,
      label: shortMetroName(m.metro),
      rank: m.rank,
      lift: m.lift,
      cells: m.cells,
      topCell: m.topCell.geohash,
      comparedWith: m.comparedWith,
      candidateSetRank: m.candidateSetRank,
      flags: m.flags,
      basis: "age-band" as const,
      evidenceIds: [heatmap.evidence.id],
    }));
    const genres = topGenres(artists.data);
    rawArtists.push(artists.data);
    raw.set(segmentIdFor(bucket), {
      artists: artists.data,
      brands: brands.data,
      heatmap: heatmap.data,
      evidence: { artists: artists.evidence.id, brands: brands.evidence.id, heatmap: heatmap.evidence.id },
    });
    built.push({
      id: segmentIdFor(bucket),
      bucket,
      ageBand: band,
      skew: input.proof.demographics.age[bucket],
      label: segmentLabel(bucket, genres),
      genres,
      cities,
      artists: refs(artists.data, artists.evidence.id),
      brands: refs(brands.data, brands.evidence.id),
      evidenceIds: [...input.proof.demographics.evidenceIds, artists.evidence.id, brands.evidence.id, heatmap.evidence.id],
    });
    lists.push({ artists: artists.data.map((e) => e.id), brands: brands.data.map((e) => e.id) });
  }

  let distinctness: number | null = null;
  let merged = false;
  if (built.length === 2) {
    const [a, b] = built;
    const [la, lb] = lists;
    distinctness = Number((1 - (topOverlap(la.artists, lb.artists) + topOverlap(la.brands, lb.brands)) / 2).toFixed(2));
    if (shouldMerge(distinctness)) {
      merged = true;
      decide(env, "segments", `Merged ${a.ageBand} and ${b.ageBand} into one world`, `They share most of their tastes (distinctness ${distinctness}, under ${MERGE_BELOW}).`);
      built.pop();
      // The merged world covers both bands.
      a.ageBand = `${a.ageBand} and ${b.ageBand}`;
      a.label = [a.ageBand, a.genres.length ? a.genres.join(" and ") : null].filter(Boolean).join(" · ");
    } else {
      // Name each world by what sets it apart from the other.
      for (const [i, segment] of built.entries()) {
        segment.genres = topGenres(rawArtists[i], rawArtists[1 - i]);
        segment.label = segmentLabel(segment.bucket, segment.genres);
      }
      decide(env, "segments", `Kept two worlds: ${a.label} and ${b.label}`, `Distinctness ${distinctness}: their top artists and brands differ.`);
    }
  }
  return { segments: { items: built, distinctness, merged }, raw };
}
