import { describe, expect, it } from "vitest";
import { conceptsFile, fitsCap, frozenPackFile, planRuns, runFile } from "./baseline-jobs";

const files = (...paths: string[]) => {
  const set = new Set(paths);
  return (file: string) => set.has(file);
};

describe("planRuns", () => {
  it("generates missing runs and skips existing ones without --force", () => {
    const plan = planRuns({ slugs: ["a"], runs: 3, force: false, rerollControl: false, exists: files(runFile("a", 1)) });
    expect(plan.pending.map((j) => j.run)).toEqual([2, 3]);
    expect(plan.skipped).toBe(1);
  });

  it("never replaces the Control with --force alone", () => {
    const exists = files(runFile("a", 1), runFile("a", 2));
    const plan = planRuns({ slugs: ["a"], runs: 2, force: true, rerollControl: false, exists });
    expect(plan.pending.map((j) => j.run)).toEqual([2]);
    expect(plan.kept).toEqual([{ slug: "a", reason: "control" }]);
  });

  it("re-rolls the Control only when asked, and never once its pack is frozen", () => {
    const open = planRuns({ slugs: ["a"], runs: 1, force: true, rerollControl: true, exists: files(runFile("a", 1)) });
    expect(open.pending.map((j) => j.run)).toEqual([1]);

    const frozen = planRuns({
      slugs: ["a"],
      runs: 1,
      force: true,
      rerollControl: true,
      exists: files(runFile("a", 1), frozenPackFile("a")),
    });
    expect(frozen.pending).toEqual([]);
    expect(frozen.kept).toEqual([{ slug: "a", reason: "frozen" }]);
  });

  it("names files predictably", () => {
    expect(runFile("food-coffee", 2)).toBe("data/baselines/food-coffee/run-2.json");
    expect(conceptsFile("food-coffee")).toBe("data/baselines/food-coffee/concepts.json");
  });
});

describe("fitsCap", () => {
  it("stops before a step with a repair could cross the cap", () => {
    expect(fitsCap(38, 2, 40)).toBe(true);
    expect(fitsCap(39, 2, 40)).toBe(false);
  });
});
