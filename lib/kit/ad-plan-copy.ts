// The ad plan's fixed wording and its "what to watch" sentence, kept apart from the entry builder
// (ad-plan.ts) so view code that runs in the browser can share it without importing the Report
// contract. Types only from the prompt modules: no zod schemas, no hashing.
import type { Concept } from "../prompts/brief";

export const AD_PLAN_NOTE = "Targeting suggestions from aggregate taste data.";
export const AD_PLAN_OPTIONAL =
  "The age bands and cities are optional: use them only where a campaign allows them, and leave broad campaigns broad. The cities are where this world's age band clusters; the ad's own setting comes from the audience's headline cities.";
/** Cities shown per world at most (the top of its ranked list). */
export const AD_PLAN_MAX_CITIES = 5;

/** The concept's test hypothesis as one "Watch ..." sentence: a question to answer, never a result. Null without one. */
export function hypothesisWatch(concept: Pick<Concept, "testHypothesis">): string | null {
  const hypothesis = concept.testHypothesis?.trim().replace(/[.!?]+$/, "");
  if (!hypothesis) return null;
  return /^whether\b/i.test(hypothesis) ? `Watch ${hypothesis.charAt(0).toLowerCase()}${hypothesis.slice(1)}.` : `Watch: ${hypothesis}.`;
}
