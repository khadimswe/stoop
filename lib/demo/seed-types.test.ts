import { describe, expect, it } from "vitest";
import { CANDIDATES } from "./candidates";
import { poolSeeds, SEED_TYPES, seedType } from "./seed-types";

describe("seed types", () => {
  it("cover every seed in the candidate pool, and nothing else", () => {
    expect(poolSeeds().sort()).toEqual(Object.keys(SEED_TYPES).sort());
    for (const candidate of CANDIDATES) for (const seed of candidate.seeds) expect(seedType(seed)).toBeTruthy();
  });

  it("throw for an unknown seed instead of guessing a type", () => {
    expect(() => seedType("Not a seed")).toThrow(/No entity type/);
  });
});
