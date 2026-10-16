// The written rubric for the Creative Director stage. The LLM-only Control and the Qloo path both
// score their concepts with this exact text, so the creative instructions are identical and only the
// data behind the brief differs. Judges can read the same text on the report and in the trace.
import { z } from "zod";

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Scored 1 to 5. The order here is the order shown to the model and to judges. */
export const RUBRIC_CRITERIA = [
  {
    id: "scroll_stop",
    label: "Scroll-stop",
    question: "Would this stop a thumb in the first second?",
  },
  {
    id: "specificity",
    label: "Specificity",
    question:
      "Are the details concrete and particular (this kind of place, this object, this gesture, this line) rather than generic ones any brand could use?",
  },
  {
    id: "product_role",
    label: "Product role",
    question:
      "Is the product used on screen, not just held up, and is it the hero of the story, staged so a video model can render it (still or simple moves, hands off the label, no close-up label text)?",
  },
  {
    id: "emotional_clarity",
    label: "Emotional clarity",
    question: "Does the concept land one clear emotion instead of several mixed ones?",
  },
  {
    id: "insider_not_outsider",
    label: "Insider, not outsider",
    question: "Does it feel made by someone inside this audience's world, not an outsider's guess about it?",
  },
  {
    id: "surprise",
    label: "Surprise",
    question: "How strong is the one surprise or escalation beat?",
  },
] as const;
export type CriterionId = (typeof RUBRIC_CRITERIA)[number]["id"];
export const CRITERION_IDS = RUBRIC_CRITERIA.map((criterion) => criterion.id) as readonly CriterionId[];

/** Pass or fail. A concept that fails any gate is discarded whatever its scores. */
export const HARD_GATES = [
  {
    id: "no_stereotype",
    label: "No stereotype",
    question: "Does any part rely on a stereotype about a group? Fail means discard.",
    pass: "Passes only when nothing in the concept relies on a stereotype.",
  },
  {
    id: "has_surprise_beat",
    label: "One surprise beat",
    question: "Is there exactly one clear surprise or escalation beat? Fail means discard.",
    pass: "Passes only when there is exactly one clear surprise or escalation beat.",
  },
] as const;
export type GateId = (typeof HARD_GATES)[number]["id"];
export const GATE_IDS = HARD_GATES.map((gate) => gate.id) as readonly GateId[];

export const REASON_MAX = 300;

/** One concept's score. `gates` holds true when the concept passes that gate. */
export type RubricScore = {
  scores: Record<CriterionId, number>;
  gates: Record<GateId, boolean>;
  reason: string;
};

const criterionScore = z
  .int({ error: "scores are whole numbers from 1 to 5" })
  .min(SCORE_MIN, { error: "scores run from 1 to 5" })
  .max(SCORE_MAX, { error: "scores run from 1 to 5" });
const gateResult = z.boolean({ error: "gates are true (pass) or false (fail)" });

export const rubricScoreSchema = z.strictObject({
  scores: z.strictObject(
    Object.fromEntries(CRITERION_IDS.map((id) => [id, criterionScore])) as Record<CriterionId, typeof criterionScore>,
  ),
  gates: z.strictObject(Object.fromEntries(GATE_IDS.map((id) => [id, gateResult])) as Record<GateId, typeof gateResult>),
  reason: z
    .string()
    .trim()
    .min(1, { error: "reason is required" })
    .max(REASON_MAX, { error: `reason must be ${REASON_MAX} characters or fewer` }),
}) satisfies z.ZodType<RubricScore>;

/** Sum of the criterion scores (6 to 30). Gates do not add points. */
export function totalScore(score: RubricScore): number {
  return CRITERION_IDS.reduce((sum, id) => sum + score.scores[id], 0);
}

export function passesGates(score: RubricScore): boolean {
  return GATE_IDS.every((id) => score.gates[id] === true);
}

/**
 * Keeps the best concept. Concepts that fail a gate are discarded; the rest are ranked by total score,
 * then by specificity, then by their original order, so the same scores always pick the same concept.
 */
export function pickBest<T extends { rubric: RubricScore }>(
  concepts: readonly T[],
): { best: T | null; ranked: T[]; discarded: T[] } {
  const discarded = concepts.filter((concept) => !passesGates(concept.rubric));
  const ranked = concepts
    .map((concept, index) => ({ concept, index }))
    .filter(({ concept }) => passesGates(concept.rubric))
    .sort(
      (a, b) =>
        totalScore(b.concept.rubric) - totalScore(a.concept.rubric) ||
        b.concept.rubric.scores.specificity - a.concept.rubric.scores.specificity ||
        a.index - b.index,
    )
    .map(({ concept }) => concept);
  return { best: ranked[0] ?? null, ranked, discarded };
}

/** The rubric as plain text, for model instructions and for judges. */
export const RUBRIC_TEXT = [
  "Creative Director rubric",
  "",
  `Score every concept on each criterion with a whole number from ${SCORE_MIN} to ${SCORE_MAX}:`,
  "1 = missing or weak, 2 = below par, 3 = workable, 4 = strong, 5 = excellent.",
  "",
  ...RUBRIC_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion.label}: ${criterion.question}`),
  "",
  "Specificity is checked against the brief: details must come from the brief, not invented.",
  "",
  "Hard gates (pass or fail, fail means discard):",
  ...HARD_GATES.map((gate) => `- ${gate.label}: ${gate.question} ${gate.pass}`),
  "",
  "A concept that fails any gate is discarded, whatever its scores.",
  "The best concept passes every gate and has the highest total. Ties go to higher specificity.",
  `Give one short reason (at most ${REASON_MAX} characters) for each concept's scores.`,
].join("\n");
