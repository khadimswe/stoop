// The event rubric, adapted from Stoop's Creative Director rubric (lib/prompts/rubric.ts) for a table
// outside a phone store: would someone on the sidewalk stop, is it specific to this city and block,
// does the manager's offer have a natural place, does it fit, and can the store pull it off. A
// stereotype is a hard gate. The writer never only grades itself: specificity is capped by how many
// distinct Qloo artists, places and styles the concept actually uses.
export const PLAN_CRITERIA = [
  { id: "stops_people", label: "Stops people", question: "Would someone walking past on the sidewalk stop in the first few seconds?" },
  { id: "specificity", label: "Specificity", question: "Are the details concrete and particular to this city and this block (this music, this food spot, this park) rather than what any store could do?" },
  { id: "offer_role", label: "The offer's role", question: "Does the manager's offer have a natural place at the table without turning the event into a hard sell? With no offer, does the event still give people a reason to come in?" },
  { id: "local_fit", label: "Local fit", question: "Does it fit what Qloo measured for this city's music and this block's places?" },
  { id: "feasibility", label: "Feasibility", question: "Can the store run it with its budget, its setting and two or three staff, on a public sidewalk?" },
] as const;
export type PlanCriterionId = (typeof PLAN_CRITERIA)[number]["id"];
export const PLAN_CRITERION_IDS = PLAN_CRITERIA.map((c) => c.id) as readonly PlanCriterionId[];

export const PLAN_GATE = { id: "no_stereotype", label: "No stereotype", question: "Does any part rely on a stereotype about a group of people? Fail means discard." } as const;

export interface PlanScore {
  scores: Record<PlanCriterionId, number>;
  noStereotype: boolean;
}

/** Specificity can be at most 2 plus the number of distinct Qloo items a concept uses, up to 5. */
export function specificityCap(distinctQlooItems: number): number {
  return Math.min(5, 2 + Math.max(0, distinctQlooItems));
}

export const clampScore = (value: number) => Math.min(5, Math.max(1, Math.round(value)));

/** The scores after the specificity cap. */
export function bounded(score: PlanScore, distinctQlooItems: number): PlanScore {
  return { ...score, scores: { ...score.scores, specificity: Math.min(clampScore(score.scores.specificity), specificityCap(distinctQlooItems)) } };
}

export function planTotal(score: PlanScore): number {
  return PLAN_CRITERION_IDS.reduce((sum, id) => sum + clampScore(score.scores[id]), 0);
}

/**
 * The kept concept: of those that pass the gate, the highest total, then the higher specificity, then
 * the earlier one, so the same scores always keep the same concept. Null when none passes.
 */
export function pickKept<T extends { score: PlanScore }>(concepts: readonly T[]): T | null {
  const ranked = concepts
    .map((concept, index) => ({ concept, index }))
    .filter(({ concept }) => concept.score.noStereotype)
    .sort((a, b) => planTotal(b.concept.score) - planTotal(a.concept.score) || b.concept.score.scores.specificity - a.concept.score.scores.specificity || a.index - b.index);
  return ranked[0]?.concept ?? null;
}

export const PLAN_RUBRIC_TEXT = [
  "Event rubric",
  "",
  "Score every concept on each criterion with a whole number from 1 to 5:",
  "1 = missing or weak, 2 = below par, 3 = workable, 4 = strong, 5 = excellent.",
  "",
  ...PLAN_CRITERIA.map((c, i) => `${i + 1}. ${c.label}: ${c.question}`),
  "",
  "Specificity is checked against the data: details must come from the city and block data, not invented.",
  "",
  `Hard gate: ${PLAN_GATE.label}: ${PLAN_GATE.question}`,
  "The kept concept passes the gate and has the highest total. Ties go to higher specificity.",
].join("\n");
