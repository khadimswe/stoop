// Gate 2 math: the pure functions behind docs/data-check.md. Nothing here calls Qloo; inputs are
// parsed recorded responses.
import { median, panelPosition } from "../qloo/lift";
import { normalizeName } from "../qloo/match";

export { ageBandLabel } from "../types";
// Moved to lib/stages/measure.ts in Gate 3 (the stages use them too); re-exported so callers stay the same.
export {
  AGE_GAP_MARGIN,
  ageGap,
  bucketsForBand,
  cityRank,
  guessedMetro,
  meanSkew,
  pickSegmentBuckets,
  rankedBuckets,
  topOverlap,
} from "../stages/measure";

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

