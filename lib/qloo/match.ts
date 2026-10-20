// Accepting a Qloo search hit. /search always returns its best guess, and filler follows the real
// match (another artist with a similar name, fixtures/probe-search.json), so a hit only counts when
// its name matches what was asked for.

/** Lowercase, accents and punctuation removed, "&" read as "and", a leading "the" dropped. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function sameName(a: string, b: string): boolean {
  const left = normalizeName(a);
  return left.length > 0 && left === normalizeName(b);
}

/** An affix match needs a query of at least this many words, so "The Bear" can never accept "Bear Grylls". */
export const AFFIX_MIN_WORDS = 2;

/** True when `name` begins or ends with the whole multi-word `query` on a word boundary ("Jane Doe: Field Notes" for "Field Notes"). */
function affixMatch(query: string, name: string): boolean {
  const q = normalizeName(query);
  const n = normalizeName(name);
  return q.split(" ").length >= AFFIX_MIN_WORDS && (n.startsWith(`${q} `) || n.endsWith(` ${q}`));
}

export type MatchKind = "exact" | "affix";

/**
 * The result that matches the query, with how it matched (for the receipt), or undefined. An exact
 * (normalized) name anywhere in the list wins. Otherwise only the top hit may match, and only when
 * its name starts or ends with the whole query of 2 or more words: Qloo lists some entities under
 * longer names (a product line after a brand's name, a host's name before or after a show's title).
 * Filler further down never counts.
 */
export function matchResult<T extends { name: string }>(query: string, results: readonly T[]): { result: T; match: MatchKind } | undefined {
  const exact = results.find((result) => sameName(query, result.name));
  if (exact) return { result: exact, match: "exact" };
  const top = results[0];
  return top && affixMatch(query, top.name) ? { result: top, match: "affix" } : undefined;
}

export function acceptMatch<T extends { name: string }>(query: string, results: readonly T[]): T | undefined {
  return matchResult(query, results)?.result;
}

const words = (text: string) => new Set(normalizeName(text).split(" ").filter(Boolean));

/**
 * How closely a tag's name matches an abstract creative choice, from 0 to 1: 1 for the same words
 * (spaces ignored, so "Acousticindiefolk" matches "acoustic indie folk"), else the word overlap
 * (Jaccard). "indie electronic pop" vs "Indie Pop" is 0.67.
 */
export function tagSimilarity(query: string, tagName: string): number {
  const compact = (text: string) => normalizeName(text).replace(/ /g, "");
  if (compact(query).length > 0 && compact(query) === compact(tagName)) return 1;
  const asked = words(query);
  const have = words(tagName);
  let shared = 0;
  for (const word of asked) if (have.has(word)) shared++;
  const union = asked.size + have.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Below this similarity a choice is "unverifiable" rather than mapped to a loosely related tag. */
export const TAG_MATCH_THRESHOLD = 0.5;

/** The most similar tag at or above the threshold (ties keep Qloo's order), with its similarity for the receipt. */
export function bestTag<T extends { name: string }>(query: string, tags: readonly T[], threshold = TAG_MATCH_THRESHOLD) {
  let best: { tag: T; similarity: number } | undefined;
  for (const tag of tags) {
    const similarity = tagSimilarity(query, tag.name);
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { tag, similarity };
  }
  return best;
}
