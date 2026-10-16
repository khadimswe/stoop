import { describe, expect, it } from "vitest";
import {
  CRITERION_IDS,
  GATE_IDS,
  HARD_GATES,
  RUBRIC_CRITERIA,
  RUBRIC_TEXT,
  pickBest,
  passesGates,
  rubricScoreSchema,
  totalScore,
  type CriterionId,
  type GateId,
  type RubricScore,
} from "./rubric";

const score = (
  overrides: Partial<Record<CriterionId, number>> = {},
  gates: Partial<Record<GateId, boolean>> = {},
): RubricScore => ({
  scores: { scroll_stop: 3, specificity: 3, product_role: 3, emotional_clarity: 3, insider_not_outsider: 3, surprise: 3, ...overrides },
  gates: { no_stereotype: true, has_surprise_beat: true, ...gates },
  reason: "Clear hook, product in use.",
});
const concept = (id: string, rubric: RubricScore) => ({ id, rubric });
const ids = (concepts: readonly { id: string }[]) => concepts.map((c) => c.id);

describe("rubric definitions", () => {
  it("has six criteria and two gates with unique ids", () => {
    expect(CRITERION_IDS).toEqual(["scroll_stop", "specificity", "product_role", "emotional_clarity", "insider_not_outsider", "surprise"]);
    expect(GATE_IDS).toEqual(["no_stereotype", "has_surprise_beat"]);
    expect(new Set(CRITERION_IDS).size).toBe(CRITERION_IDS.length);
  });

  it("asks the scroll-stop question in plain words", () => {
    expect(RUBRIC_CRITERIA[0].question).toBe("Would this stop a thumb in the first second?");
  });
});

describe("totalScore and passesGates", () => {
  it("sums the criteria", () => {
    expect(totalScore(score())).toBe(18);
    expect(totalScore(score({ scroll_stop: 5, surprise: 1 }))).toBe(18);
    expect(totalScore(score({ scroll_stop: 5, specificity: 5, product_role: 5, emotional_clarity: 5, insider_not_outsider: 5, surprise: 5 }))).toBe(30);
  });

  it("passes only when every gate passes", () => {
    expect(passesGates(score())).toBe(true);
    expect(passesGates(score({}, { no_stereotype: false }))).toBe(false);
    expect(passesGates(score({}, { has_surprise_beat: false }))).toBe(false);
  });
});

describe("pickBest", () => {
  it("returns nothing for no concepts", () => {
    expect(pickBest([])).toEqual({ best: null, ranked: [], discarded: [] });
  });

  it("ranks by total, highest first", () => {
    const result = pickBest([concept("a", score()), concept("b", score({ scroll_stop: 5 })), concept("c", score({ surprise: 4 }))]);
    expect(ids(result.ranked)).toEqual(["b", "c", "a"]);
    expect(result.best?.id).toBe("b");
    expect(result.discarded).toEqual([]);
  });

  it("breaks a tie on total with higher specificity", () => {
    const result = pickBest([
      concept("loud", score({ scroll_stop: 5, specificity: 2 })),
      concept("precise", score({ scroll_stop: 3, specificity: 4 })),
    ]);
    expect(totalScore(result.ranked[0].rubric)).toBe(totalScore(result.ranked[1].rubric));
    expect(ids(result.ranked)).toEqual(["precise", "loud"]);
  });

  it("keeps the original order when total and specificity tie", () => {
    const result = pickBest([
      concept("first", score({ scroll_stop: 4, surprise: 2 })),
      concept("second", score({ scroll_stop: 2, surprise: 4 })),
      concept("third", score()),
    ]);
    expect(ids(result.ranked)).toEqual(["first", "second", "third"]);
  });

  it("discards any concept that fails a gate, however high it scores", () => {
    const top = score({ scroll_stop: 5, specificity: 5, product_role: 5, emotional_clarity: 5, insider_not_outsider: 5, surprise: 5 });
    const result = pickBest([
      concept("stereotype", { ...top, gates: { no_stereotype: false, has_surprise_beat: true } }),
      concept("flat", { ...top, gates: { no_stereotype: true, has_surprise_beat: false } }),
      concept("ok", score()),
    ]);
    expect(result.best?.id).toBe("ok");
    expect(ids(result.ranked)).toEqual(["ok"]);
    expect(ids(result.discarded)).toEqual(["stereotype", "flat"]);
  });

  it("returns null when every concept fails a gate", () => {
    const result = pickBest([concept("a", score({}, { no_stereotype: false })), concept("b", score({}, { has_surprise_beat: false }))]);
    expect(result.best).toBeNull();
    expect(result.ranked).toEqual([]);
    expect(ids(result.discarded)).toEqual(["a", "b"]);
  });

  it("does not reorder the input array", () => {
    const input = [concept("low", score({ surprise: 1 })), concept("high", score({ surprise: 5 }))];
    pickBest(input);
    expect(ids(input)).toEqual(["low", "high"]);
  });
});

describe("rubricScoreSchema", () => {
  it("accepts a complete score", () => {
    expect(rubricScoreSchema.parse(score())).toEqual(score());
    expect(rubricScoreSchema.safeParse(score({ scroll_stop: 1, surprise: 5 })).success).toBe(true);
  });

  it.each([0, 6, 2.5, Number.NaN, -1])("rejects a criterion score of %s", (value) => {
    expect(rubricScoreSchema.safeParse(score({ specificity: value })).success).toBe(false);
  });

  it("rejects a score given as a string", () => {
    const bad = { ...score(), scores: { ...score().scores, surprise: "4" } };
    expect(rubricScoreSchema.safeParse(bad).success).toBe(false);
  });

  it("requires every criterion and every gate", () => {
    const partialScores: Partial<RubricScore["scores"]> = { ...score().scores };
    delete partialScores.surprise;
    expect(rubricScoreSchema.safeParse({ ...score(), scores: partialScores }).success).toBe(false);
    const partialGates: Partial<RubricScore["gates"]> = { ...score().gates };
    delete partialGates.has_surprise_beat;
    expect(rubricScoreSchema.safeParse({ ...score(), gates: partialGates }).success).toBe(false);
  });

  it("rejects unknown criteria, unknown gates and extra fields", () => {
    expect(rubricScoreSchema.safeParse({ ...score(), scores: { ...score().scores, vibes: 5 } }).success).toBe(false);
    expect(rubricScoreSchema.safeParse({ ...score(), gates: { ...score().gates, on_brand: true } }).success).toBe(false);
    expect(rubricScoreSchema.safeParse({ ...score(), total: 18 }).success).toBe(false);
  });

  it("rejects gates that are not booleans", () => {
    expect(rubricScoreSchema.safeParse({ ...score(), gates: { no_stereotype: "pass", has_surprise_beat: true } }).success).toBe(false);
  });

  it("requires a reason of 1 to 300 characters", () => {
    expect(rubricScoreSchema.safeParse({ ...score(), reason: "" }).success).toBe(false);
    expect(rubricScoreSchema.safeParse({ ...score(), reason: "   " }).success).toBe(false);
    expect(rubricScoreSchema.safeParse({ ...score(), reason: "x".repeat(300) }).success).toBe(true);
    expect(rubricScoreSchema.safeParse({ ...score(), reason: "x".repeat(301) }).success).toBe(false);
  });
});

describe("RUBRIC_TEXT", () => {
  it("includes every criterion with its question", () => {
    for (const criterion of RUBRIC_CRITERIA) {
      expect(RUBRIC_TEXT).toContain(criterion.label);
      expect(RUBRIC_TEXT).toContain(criterion.question);
    }
  });

  it("includes every gate and says a failed gate means discard", () => {
    for (const gate of HARD_GATES) {
      expect(RUBRIC_TEXT).toContain(gate.label);
      expect(RUBRIC_TEXT).toContain(gate.question);
    }
    expect(RUBRIC_TEXT.toLowerCase()).toContain("fail means discard");
  });

  it("states the scale and that specificity comes from the brief", () => {
    expect(RUBRIC_TEXT).toContain("1 to 5");
    expect(RUBRIC_TEXT).toContain("Specificity is checked against the brief: details must come from the brief, not invented.");
  });

  it("never contains an em dash", () => {
    expect(RUBRIC_TEXT).not.toContain(String.fromCharCode(0x2014));
  });
});
