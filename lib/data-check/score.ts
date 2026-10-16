// Gate 2 math: the pure functions behind docs/data-check.md. Nothing here calls Qloo; inputs are
// parsed recorded responses.
import { AGE_BUCKETS, type AgeBucket } from "../qloo/constants";
import { median, panelPosition } from "../qloo/lift";
import { normalizeName, sameName } from "../qloo/match";
import type { DemographicsRow } from "../qloo/types";

export { ageBandLabel } from "../types";

// --- Control text to tag queries -------------------------------------------------------------

const DESCRIPTORS = new Set(["upbeat", "soft", "light", "modern", "intimate", "warm", "gentle", "bouncy", "mellow", "bright", "slow", "punchy", "chill", "relaxed", "minimal", "dreamy"]);
const GENERIC_NOUNS = new Set(["groove", "beat", "beats", "feel", "track", "music", "sound", "vibe", "instrumental"]);

/** "Upbeat funk-soul groove with a tight drum break, ..." -> "funk-soul": the genre phrase a tag can match. */
export function musicTerm(style: string): string {
  const head = style.split(/\s+with\s+|[,:;(]/i)[0].trim();
  const words = head.split(/\s+/);
  while (words.length > 1 && DESCRIPTORS.has(words[0].toLowerCase())) words.shift();
  while (words.length > 1 && GENERIC_NOUNS.has((words.at(-1) as string).toLowerCase())) words.pop();
  return words.join(" ");
}

/** "Calm, confident, tactile" -> "Calm": the mood's lead word, matched against Qloo's emotional-tone tags. */
export function moodTerm(mood: string): string {
  return mood.split(/[,;]/)[0].trim();
}

export const slugOf = (text: string) => normalizeName(text).replace(/ /g, "-");

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
export function bucketsForBand(text: string): AgeBucket[] {
  const match = /(\d{2}) to (\d{2})/.exec(text);
  if (!match) return [];
  const low = Number(match[1]);
  const high = Number(match[2]);
  const ranges: Record<AgeBucket, [number, number]> = {
    "24_and_younger": [18, 24],
    "25_to_29": [25, 29],
    "30_to_34": [30, 34],
    "35_to_44": [35, 44],
    "45_to_54": [45, 54],
    "55_and_older": [55, 120],
  };
  return AGE_BUCKETS.filter((b) => ranges[b][0] <= high && ranges[b][1] >= low);
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

// --- Reference panels -------------------------------------------------------------------------

export interface PanelCandidate {
  id: string;
  name: string;
  popularity: number;
  /** Which candidate's recorded list it came from (spread rule) and the fixture request (receipt). */
  source: string;
  request: string;
}

/**
 * A frozen reference panel: `size` entries spread evenly across popularity, at most `maxPerSource`
 * from any one candidate's list, never one of the excluded ids (seeds and Control references, so a
 * panel never contains what it is used to score). Deterministic for the same pool.
 */
export function buildPanel(
  pool: readonly PanelCandidate[],
  options: { size?: number; maxPerSource?: number; exclude?: ReadonlySet<string> } = {},
): PanelCandidate[] {
  const size = options.size ?? 25;
  const maxPerSource = options.maxPerSource ?? 3;
  const exclude = options.exclude ?? new Set<string>();
  const seen = new Set<string>();
  const eligible = pool
    .filter((c) => !exclude.has(c.id.toUpperCase()) && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => a.popularity - b.popularity || a.id.localeCompare(b.id));
  if (eligible.length < size) throw new Error(`Only ${eligible.length} eligible entries for a panel of ${size}.`);
  const picked: PanelCandidate[] = [];
  const used = new Set<string>();
  const perSource = new Map<string, number>();
  for (let i = 0; i < size; i++) {
    const target = Math.round((i * (eligible.length - 1)) / (size - 1));
    // Walk outward from the quantile position to the nearest entry that keeps the spread rule.
    for (let offset = 0; offset < eligible.length; offset++) {
      const pick = [target + offset, target - offset].map((j) => eligible[j]).find(
        (c) => c && !used.has(c.id) && (perSource.get(c.source) ?? 0) < maxPerSource,
      );
      if (pick) {
        picked.push(pick);
        used.add(pick.id);
        perSource.set(pick.source, (perSource.get(pick.source) ?? 0) + 1);
        break;
      }
    }
  }
  if (picked.length < size) throw new Error(`Could only fill ${picked.length} of ${size} panel slots under the spread rule.`);
  return picked.sort((a, b) => a.popularity - b.popularity || a.id.localeCompare(b.id));
}

// --- Signal levels ----------------------------------------------------------------------------

export type SignalLevel = "rich" | "thin" | "none";

/** A Qloo pick counts as strong when it beats at least this share of the reference panel. */
export const STRONG_SHARE = 0.75;

/**
 * How many of Qloo's top picks beat at least 75% of the panel, all scored in one call. `rich` at 3
 * or more, `thin` at 1 to 2, `none` at 0. On Gate 2's whole-audience data every panel-scored field
 * is rich (docs/data-check.md), so the thresholds are re-checked per segment in Gate 4.
 */
export function signalLevel(pickScores: readonly number[], panelScores: readonly number[]): { level: SignalLevel; strong: number } {
  const strong = pickScores.filter((score) => {
    const { beats, of } = panelPosition(score, panelScores);
    return of > 0 && beats / of >= STRONG_SHARE;
  }).length;
  return { level: strong >= 3 ? "rich" : strong >= 1 ? "thin" : "none", strong };
}

/** Panel position of one choice, or null when Qloo did not return it ("no measurable affinity"). */
export function choicePosition(score: number | null | undefined, panelScores: readonly number[]) {
  if (score === null || score === undefined) return null;
  const position = panelPosition(score, panelScores);
  return { ...position, belowMedian: position.aboveMedian === false, panelMedian: median(panelScores) };
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
