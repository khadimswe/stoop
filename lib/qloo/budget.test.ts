import { describe, expect, it } from "vitest";
import { OFFLINE_CAP, PLANNED_CALLS, REVISE_CAP, RUN_BUDGET, RUN_CAP } from "./budget";

describe("run budget", () => {
  it("plans no more calls than the run cap", () => {
    expect(PLANNED_CALLS).toBeLessThanOrEqual(RUN_CAP);
  });

  it("gives every stage a positive allowance", () => {
    for (const calls of Object.values(RUN_BUDGET)) expect(calls).toBeGreaterThan(0);
  });

  it("keeps revisions small and offline generation bounded", () => {
    expect(REVISE_CAP).toBeLessThan(RUN_CAP);
    expect(OFFLINE_CAP).toBeGreaterThanOrEqual(RUN_CAP);
  });
});
