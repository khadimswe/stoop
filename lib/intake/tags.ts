// One short phrase to one Qloo tag, for the intake: the taste tags read from a page or a stated
// customer (./site-reading.ts) and the category tags behind Qloo seeds (./seeds.ts). /v2/tags matches
// loosely, so the best tag must share most of its words with the phrase (bestTag in
// lib/qloo/match.ts); otherwise the phrase is unresolved and dropped. Tag names Qloo returns pass
// the guardrails or are skipped ("Teen Pop" is never a seed). The params follow the Gate 2
// recordings (take 10; music and place genres typed, anything else untyped), so replays hit.
import type { Evidence } from "../evidence";
import { checkText } from "../guardrails";
import { ENDPOINTS } from "../qloo/constants";
import { bestTag, normalizeName } from "../qloo/match";
import type { LabeledRequest, ReceiptLookup } from "../qloo/resolve";
import { tagsResponse } from "../qloo/types";

/**
 * Which tags a phrase may become. Music and place genres are the typed searches Gate 2 proved
 * (fixtures/pool-resolve.json); "general" is the untyped search for categories and other tastes
 * (fixtures/probe-search.json "hot sauce"). Emotional-tone tags are not indexed by tag search.
 */
export const TASTE_TAG_KINDS = {
  music: "urn:tag:genre:music",
  place: "urn:tag:genre:place",
  general: null,
} as const;
export type TasteTagKind = keyof typeof TASTE_TAG_KINDS;
export const TASTE_KIND_NAMES = Object.keys(TASTE_TAG_KINDS) as [TasteTagKind, ...TasteTagKind[]];

export const TAG_TAKE = 10;
export const MAX_PHRASE_WORDS = 4;
export const MAX_PHRASE_CHARS = 40;

/** The phrase as Qloo is asked for it ("Lo-fi hip hop" and "lo-fi hip-hop" both send "lo fi hip hop"), or null when unusable. */
export function tagPhrase(phrase: string): string | null {
  const normalized = normalizeName(phrase);
  if (!normalized || normalized.length > MAX_PHRASE_CHARS || normalized.split(" ").length > MAX_PHRASE_WORDS) return null;
  return normalized;
}

const KIND_LABELS: Record<TasteTagKind, string> = { music: "a Qloo music genre tag", place: "a Qloo place type tag", general: "a Qloo tag" };

export function tagRequest(kind: TasteTagKind, phrase: string): LabeledRequest | null {
  const query = tagPhrase(phrase);
  if (!query) return null;
  const type = TASTE_TAG_KINDS[kind];
  return {
    id: `tags--${kind}--${query.replace(/ /g, "-")}`,
    endpoint: ENDPOINTS.tags,
    params: { "filter.query": query, ...(type ? { "filter.tag.types": [type] } : {}), take: TAG_TAKE },
    label: `Finding ${KIND_LABELS[kind]} for "${collapsePhrase(phrase)}"`,
  };
}

const collapsePhrase = (phrase: string) => phrase.replace(/\s+/g, " ").trim().slice(0, MAX_PHRASE_CHARS);

export interface ResolvedTag {
  /** The phrase as offered. */
  query: string;
  kind: TasteTagKind;
  /** The /v2/tags request id behind the answer, or null when the phrase was unusable (no call). */
  request: string | null;
  /** The receipt for that call. */
  evidence?: Evidence;
  tag?: { id: string; name: string; type: string | null; similarity: number };
  /** Why there is no tag. */
  miss?: "unusable-phrase" | "no-match";
}

/** One /v2/tags call (none for an unusable phrase). The best matching tag of the kind, or a miss. */
export async function resolveTag(kind: TasteTagKind, phrase: string, lookup: ReceiptLookup): Promise<ResolvedTag> {
  const request = tagRequest(kind, phrase);
  if (!request) return { query: phrase, kind, request: null, miss: "unusable-phrase" };
  const { data: tags, evidence } = await lookup(request, tagsResponse);
  const type = TASTE_TAG_KINDS[kind];
  const candidates = tags.filter((tag) => (type === null || tag.type === type) && checkText(tag.name).length === 0);
  const best = bestTag(phrase, candidates);
  if (!best) return { query: phrase, kind, request: request.id, evidence, miss: "no-match" };
  return { query: phrase, kind, request: request.id, evidence, tag: { id: best.tag.id, name: best.tag.name, type: best.tag.type, similarity: best.similarity } };
}
