// Matching a concept's words to a brief's cues: accent-folded, lowercased words of 3 or more
// characters, stemmed lightly, with function words and staging words dropped. Pure and client-safe:
// the concept writer (lib/stages/concepts.ts) and the report's Output view both use it.
import { briefCueTexts, type BriefSlot, type BriefSlots } from "./brief";

/** Function words and words any ad concept uses whatever the brief says (staging, framing, time). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "into", "onto", "over", "under", "about", "after", "before", "then", "than",
  "that", "this", "these", "those", "there", "their", "them", "they", "its", "his", "her", "hers", "him", "she",
  "you", "your", "our", "ours", "who", "whom", "whose", "what", "when", "where", "which", "while", "how", "why",
  "each", "every", "any", "all", "some", "one", "two", "three", "four", "five", "are", "was", "were", "been",
  "being", "has", "have", "had", "does", "did", "doing", "can", "could", "will", "would", "should", "may",
  "might", "must", "not", "but", "nor", "yet", "also", "just", "only", "very", "more", "most", "less", "much",
  "many", "such", "like", "off", "out", "down", "through", "across", "around", "between", "near", "next",
  "beside", "behind", "above", "below", "toward", "towards", "per", "via", "upon", "inside", "outside",
  "without", "within", "again", "here", "own", "same", "other", "another", "both", "either", "neither", "few",
  "lot", "lots", "way", "ways", "thing", "things", "something", "someone", "everyone", "says", "say", "said",
  "shot", "shots", "scene", "scenes", "frame", "frames", "camera", "video", "clip", "clips", "product",
  "products", "brand", "final", "first", "last", "beat", "beats", "moment", "moments", "second", "seconds",
  "quick", "fast", "slow", "little", "small", "big", "simple", "plain", "real", "feel", "feels", "look", "looks",
  "style", "show", "shows", "seen", "see", "label", "labels", "hand", "hands", "light", "lights", "lighting", "lit",
  "cut", "cuts", "motion", "close", "ups", "hold", "holds", "overlay", "text", "sound", "audio", "time",
]);

/** A light, deterministic stem, enough to match plurals and simple verb forms. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

const STOPWORD_STEMS: ReadonlySet<string> = new Set([...STOPWORDS].map(stem));

/** The content stems of a text, by the rule above (steps 1 and 2). A word whose stem is a stopword's stem ("overlays") is dropped too. */
export function contentStems(text: string): Set<string> {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !STOPWORDS.has(word));
  return new Set(words.map(stem).filter((s) => !STOPWORD_STEMS.has(s)));
}

/** Each brief slot's distinctive stems (step 3). */
export function distinctiveStems(brief: BriefSlots): Map<BriefSlot, Set<string>> {
  const cues = briefCueTexts(brief).map((cue) => ({ slot: cue.slot, stems: contentStems(cue.text) }));
  return new Map(
    cues.map(({ slot, stems }) => {
      const others = cues.filter((other) => other.slot !== slot);
      return [slot, new Set([...stems].filter((s) => !others.some((other) => other.stems.has(s))))] as const;
    }),
  );
}
