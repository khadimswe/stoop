// Audience measurements shared by the pipeline stages (Prove, Gap, Segments) and the Gate 2 data
// check: averaging Qloo's per-seed skews, picking measured age segments, deciding whether a stated
// age band is really off, list overlap, and reading a city a brief guessed. Pure functions only.
import { AGE_BUCKETS, type AgeBucket } from "../qloo/constants";
import { sameName } from "../qloo/match";
import type { DemographicsRow } from "../qloo/types";

// --- Demographics and segments ----------------------------------------------------------------

/** Mean skew per bucket across the seeds Qloo returned rows for (Qloo gives one row per input entity). */
export function meanSkew(rows: readonly DemographicsRow[]): { age: Record<AgeBucket, number>; gender: { male: number; female: number } } {
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const age = Object.fromEntries(AGE_BUCKETS.map((b) => [b, avg(rows.map((r) => r.age[b]).filter((v) => typeof v === "number"))])) as Record<AgeBucket, number>;
  return {
    age,
    gender: {
      male: avg(rows.map((r) => r.gender.male).filter((v) => typeof v === "number")),
      female: avg(rows.map((r) => r.gender.female).filter((v) => typeof v === "number")),
    },
  };
}

/** Buckets by skew, highest first. All Qloo buckets are adult-labeled (the youngest shows as 18 to 24). */
export function rankedBuckets(age: Record<AgeBucket, number>): AgeBucket[] {
  return [...AGE_BUCKETS].sort((a, b) => age[b] - age[a] || AGE_BUCKETS.indexOf(a) - AGE_BUCKETS.indexOf(b));
}

/**
 * Up to two measured segments: the most over-indexed age bucket, then the best other bucket that
 * also over-indexes (positive skew), preferring one that is not its neighbor so the two worlds can
 * differ. A bucket that under-indexes is never a segment, so some products get one.
 */
export function pickSegmentBuckets(age: Record<AgeBucket, number>): AgeBucket[] {
  const ranked = rankedBuckets(age);
  const first = ranked[0];
  const index = (b: AgeBucket) => AGE_BUCKETS.indexOf(b);
  const positive = ranked.slice(1).filter((b) => age[b] > 0);
  const second = positive.find((b) => Math.abs(index(b) - index(first)) > 1) ?? positive[0];
  return second ? [first, second] : [first];
}

/** A stated band only counts as wrong when Qloo's top bucket beats every stated bucket by this much. */
export const AGE_GAP_MARGIN = 0.1;

/**
 * True when the measured audience clearly skews outside the stated band: the top bucket is not in
 * it, and its skew beats the best stated bucket by AGE_GAP_MARGIN (a near tie is not a gap).
 */
export function ageGap(age: Record<AgeBucket, number>, stated: readonly AgeBucket[]): boolean {
  if (stated.length === 0) return false;
  const top = rankedBuckets(age)[0];
  if (stated.includes(top)) return false;
  return age[top] - Math.max(...stated.map((b) => age[b])) >= AGE_GAP_MARGIN;
}

/** Qloo buckets that overlap a stated band such as "25 to 40". */
/** Each Qloo bucket's ages. The oldest is open-ended; it is sized like the 10-year buckets for the overlap rule. */
const BUCKET_AGES: Record<AgeBucket, [number, number]> = {
  "24_and_younger": [18, 24],
  "25_to_29": [25, 29],
  "30_to_34": [30, 34],
  "35_to_44": [35, 44],
  "45_to_54": [45, 54],
  "55_and_older": [55, 64],
};

/**
 * The Qloo buckets a stated band such as "25 to 40" really covers: at least 3 of a bucket's years,
 * or at least half of it. Touching a bucket by a year or two doesn't count ("25 to 45" does not state
 * 45 to 54, and "28 to 45" does not state 25 to 29).
 */
export function bucketsForBand(text: string): AgeBucket[] {
  const match = /(\d{2}) to (\d{2})/.exec(text);
  if (!match) return [];
  const low = Number(match[1]);
  const high = Number(match[2]);
  const overlap = (b: AgeBucket) => {
    const [from, to] = BUCKET_AGES[b];
    return Math.min(high, b === "55_and_older" ? Math.max(high, to) : to) - Math.max(low, from) + 1;
  };
  const covered = AGE_BUCKETS.filter((b) => {
    const [from, to] = BUCKET_AGES[b];
    return overlap(b) >= 3 || overlap(b) >= (to - from + 1) / 2;
  });
  // A very narrow band ("21 to 22") covers no bucket that much: it states the bucket(s) it falls in.
  return covered.length > 0 ? covered : AGE_BUCKETS.filter((b) => overlap(b) > 0);
}

/** Years a stated band spans ("25 to 40" is 16), or null without one. */
export function bandSpan(text: string): number | null {
  const match = /(\d{2}) to (\d{2})/.exec(text);
  return match ? Number(match[2]) - Number(match[1]) + 1 : null;
}

// --- Overlap ----------------------------------------------------------------------------------

/** Jaccard overlap of the first `n` ids of two ranked lists. */
export function topOverlap(a: readonly string[], b: readonly string[], n = 20): number {
  const left = new Set(a.slice(0, n));
  const right = new Set(b.slice(0, n));
  let shared = 0;
  for (const id of left) if (right.has(id)) shared++;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

// --- Cities -----------------------------------------------------------------------------------

/** Boroughs and nicknames the LLM-only briefs use, mapped to the metro city they belong to. */
const CITY_ALIASES: Readonly<Record<string, string>> = { Brooklyn: "New York" };

/**
 * The metro a guessed city most likely means. A bare name can match several metros (Portland, OR
 * and Portland, ME), and a brief names the famous one, so the match with the largest land area wins.
 */
export function guessedMetro<M extends { name: string; landSqMi: number }>(city: string, metros: readonly M[]): M | undefined {
  const target = CITY_ALIASES[city] ?? city;
  const matches = metros.filter((m) => m.name.split(", ")[0].split(/-+|\//).some((part) => sameName(part, target)));
  return [...matches].sort((a, b) => b.landSqMi - a.landSqMi)[0];
}

/** Rank (1-based) of a guessed city among the lift-ranked metros, or null if it is not among them. */
export function cityRank<M extends { name: string; landSqMi: number }>(city: string, rankedMetros: readonly M[], allMetros: readonly M[]): number | null {
  const metro = guessedMetro(city, allMetros);
  if (!metro) return null;
  const index = rankedMetros.findIndex((m) => m.name === metro.name);
  return index === -1 ? null : index + 1;
}
