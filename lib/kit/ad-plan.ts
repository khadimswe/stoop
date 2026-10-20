// One Meta + TikTok ad plan entry per concept world (plan 13.4, reframed Oct 16): one ad set (Meta) or
// ad group (TikTok) per world, grouped by concept world rather than by targeting. Broad Advantage+ and
// Smart+ campaigns can't act on age skews or city heatmaps, so the world's age bands and cities are
// optional geo options only, where a campaign allows them. "What to watch" ties to the kept concept's
// test hypothesis. It never promises results and never targets individuals: the bands and cities are
// aggregate taste data with their receipts. Zero Qloo calls: it reuses the world's receipts.
import { AGE_BUCKETS, type AgeBucket } from "../qloo/constants";
import type { Concept } from "../prompts/brief";
import { adPlanEntrySchema, type AdPlanEntry } from "../report/world";
import { AD_PLAN_MAX_CITIES, AD_PLAN_NOTE, AD_PLAN_OPTIONAL, hypothesisWatch } from "./ad-plan-copy";

export { AD_PLAN_MAX_CITIES, AD_PLAN_NOTE, AD_PLAN_OPTIONAL, hypothesisWatch };

export interface AdPlanInput {
  /** The world's label (what Qloo measured: taste, age band, region). */
  label: string;
  ageBands: readonly AgeBucket[];
  /** The world's cities in rank order, each with its receipts. */
  cities: readonly { label: string; evidenceIds: readonly string[] }[];
  /** The world's kept concept. */
  concept: Concept;
  /** The world's own receipts (its segment and culture calls). */
  evidenceIds: readonly string[];
}

/** What to watch, from the concept's test hypothesis: a question to answer, never a result. */
export function watchLine(concept: Concept): string {
  const compare = "Compare this ad set (Meta) or ad group (TikTok) with the other worlds' on the same objective and budget.";
  return `${hypothesisWatch(concept) ?? `Watch how "${concept.title}" does against the other worlds' concepts.`} ${compare}`;
}

export function adPlanEntry({ label, ageBands, cities, concept, evidenceIds }: AdPlanInput): AdPlanEntry {
  for (const city of cities) {
    if (city.evidenceIds.length === 0) throw new Error(`The city "${city.label}" has no receipt; a plan only suggests cities Qloo returned.`);
  }
  const shown = cities.slice(0, AD_PLAN_MAX_CITIES);
  const bands = AGE_BUCKETS.filter((bucket) => ageBands.includes(bucket));
  const receipts = [...new Set([...evidenceIds, ...shown.flatMap((city) => city.evidenceIds)])];
  return adPlanEntrySchema.parse({
    name: `${label}: ${concept.title}`,
    ageBands: bands,
    cities: [...new Set(shown.map((city) => city.label))],
    watch: watchLine(concept),
    note: `${AD_PLAN_NOTE} ${AD_PLAN_OPTIONAL}`,
    evidenceIds: receipts,
  });
}
