// The event rubric, adapted from Stoop's Creative Director rubric (lib/prompts/rubric.ts) for a table
// outside a phone store. A store runs an event for walk-ins and sign-ups, so "brings people inside"
// counts double; the rest asks whether someone on the sidewalk would stop, whether it is specific to
// this city and block, whether it fits the day, and whether the store can pull it off with its budget
// and the manager's notes. A stereotype is a hard gate. The writer never only grades itself:
// specificity is capped by how many distinct Qloo artists, places and styles the concept uses.
export const PLAN_CRITERIA = [
  { id: "walk_ins", label: "Brings people inside", weight: 2, question: "Does it turn a stop into a walk-in or a sign-up: a clear reason and moment to step inside, with the manager's promo doing the work? An event that sends people to other businesses scores low." },
  { id: "stops_people", label: "Stops people", weight: 1, question: "Would someone walking past on the sidewalk, or past the booth, stop in the first few seconds?" },
  { id: "specificity", label: "Specificity", weight: 1, question: "Are the details concrete and particular to this block and this city (the block's own independents, the city's most-loved artists) rather than what any store could do?" },
  { id: "fits_day", label: "Fits the day", weight: 1, question: "Does it fit the date where the date matters: a holiday, the season, the weather? A payday alone is a hint for timing, not a theme." },
  { id: "feasibility", label: "Feasibility", weight: 1, question: "Can the store run it with its budget, its setting and one or two staff, and does it do what the manager's notes ask?" },
] as const;
export type PlanCriterionId = (typeof PLAN_CRITERIA)[number]["id"];
export const PLAN_CRITERION_IDS = PLAN_CRITERIA.map((c) => c.id) as readonly PlanCriterionId[];
/** The highest total a concept can score. */
export const PLAN_MAX_TOTAL = PLAN_CRITERIA.reduce((sum, c) => sum + 5 * c.weight, 0);

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

/** The scores after clamping and the specificity cap. */
export function bounded(score: PlanScore, distinctQlooItems: number): PlanScore {
  const scores = Object.fromEntries(PLAN_CRITERION_IDS.map((id) => [id, clampScore(score.scores[id])])) as PlanScore["scores"];
  scores.specificity = Math.min(scores.specificity, specificityCap(distinctQlooItems));
  return { ...score, scores };
}

/** The weighted total ("Brings people inside" counts double). */
export function planTotal(score: PlanScore): number {
  return PLAN_CRITERIA.reduce((sum, c) => sum + clampScore(score.scores[c.id]) * c.weight, 0);
}

/**
 * The kept concept: of those that pass the gate, the highest total, then the higher "brings people
 * inside", then the higher specificity, then the earlier one, so the same scores always keep the same
 * concept. Null when none passes.
 */
export function pickKept<T extends { score: PlanScore }>(concepts: readonly T[]): T | null {
  const ranked = concepts
    .map((concept, index) => ({ concept, index }))
    .filter(({ concept }) => concept.score.noStereotype)
    .sort(
      (a, b) =>
        planTotal(b.concept.score) - planTotal(a.concept.score) ||
        b.concept.score.scores.walk_ins - a.concept.score.scores.walk_ins ||
        b.concept.score.scores.specificity - a.concept.score.scores.specificity ||
        a.index - b.index,
    );
  return ranked[0]?.concept ?? null;
}

export const PLAN_RUBRIC_TEXT = [
  "Event rubric",
  "",
  "Score every concept on each criterion with a whole number from 1 to 5:",
  "1 = missing or weak, 2 = below par, 3 = workable, 4 = strong, 5 = excellent.",
  "",
  ...PLAN_CRITERIA.map((c, i) => `${i + 1}. ${c.label}${c.weight > 1 ? " (counts double)" : ""}: ${c.question}`),
  "",
  "Specificity is checked against the data: details must come from the city and block data, not invented.",
  "",
  `Hard gate: ${PLAN_GATE.label}: ${PLAN_GATE.question}`,
  "The kept concept passes the gate and has the highest total. Ties go to the one that brings more people inside.",
].join("\n");
