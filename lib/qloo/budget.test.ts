import { describe, expect, it } from "vitest";
import { INTAKE_BUDGET, INTAKE_CAP, OFFLINE_CAP, PLANNED_CALLS, REVISE_CAP, RUN_BUDGET, RUN_CAP } from "./budget";

describe("run budget", () => {
  it("plans no more calls than the run cap", () => {
    expect(PLANNED_CALLS).toBeLessThanOrEqual(RUN_CAP);
  });

  it("plans 44 calls across the rows the stages charge", () => {
    expect(PLANNED_CALLS).toBe(44);
    expect(Object.keys(RUN_BUDGET)).toEqual(["prove", "gap", "segments", "culture", "localities", "scoring", "probes", "resolve", "searchReserve"]);
  });

  it("gives every stage a positive allowance", () => {
    for (const calls of Object.values(RUN_BUDGET)) expect(calls).toBeGreaterThan(0);
  });

  it("keeps revisions small and offline generation bounded", () => {
    expect(REVISE_CAP).toBeLessThan(RUN_CAP);
    expect(OFFLINE_CAP).toBeGreaterThanOrEqual(RUN_CAP);
  });
});

describe("intake budget", () => {
  it("caps an intake at exactly its planned calls, apart from the run cap", () => {
    expect(Object.values(INTAKE_BUDGET).reduce((sum, calls) => sum + calls, 0)).toBe(INTAKE_CAP);
    expect(INTAKE_BUDGET).toEqual({ readingTags: 2, statedTags: 2, categoryTags: 2, suggestionSearches: 8 });
    expect(INTAKE_CAP).toBeLessThan(RUN_CAP);
  });
});
