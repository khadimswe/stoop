import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkText, checkValue } from "../guardrails";
import { CANDIDATES, candidateBySlug, hasAdultAgeBand, loadCandidates, type Candidate } from "./candidates";

const committed = (): unknown => JSON.parse(readFileSync(new URL("../../data/candidates.json", import.meta.url), "utf8"));

// A smoke list, not a gazetteer: the pool must never pick a city. Cities come from Qloo only.
const CITIES = [
  "New York",
  "Brooklyn",
  "Los Angeles",
  "Chicago",
  "Houston",
  "Austin",
  "Atlanta",
  "Miami",
  "Seattle",
  "Portland",
  "San Francisco",
  "Oakland",
  "Denver",
  "Detroit",
  "Nashville",
  "Philadelphia",
  "Boston",
  "New Orleans",
];

const withoutSeeds = (candidate: Candidate) => Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "seeds"));

describe("candidate pool", () => {
  it("parses the committed file", () => {
    expect(() => loadCandidates(committed())).not.toThrow();
    expect(loadCandidates(committed())).toEqual(CANDIDATES);
  });

  it("holds exactly 9 candidates with unique slugs", () => {
    expect(CANDIDATES).toHaveLength(9);
    expect(new Set(CANDIDATES.map((c) => c.slug)).size).toBe(9);
  });

  it("states an adult age band for every customer", () => {
    for (const { slug, statedCustomer } of CANDIDATES) {
      const bands = [...statedCustomer.matchAll(/\b(\d{2}) to (\d{2})\b/g)];
      expect(bands.length, slug).toBeGreaterThan(0);
      for (const [, low, high] of bands) {
        expect(Number(low), slug).toBeGreaterThanOrEqual(18);
        expect(Number(high), slug).toBeGreaterThan(Number(low));
      }
    }
  });

  it("passes the guardrails, and no text names its own seeds", () => {
    for (const candidate of CANDIDATES) {
      expect(checkValue(withoutSeeds(candidate), { names: candidate.seeds }), candidate.slug).toEqual([]);
      expect(checkValue(candidate.seeds), candidate.slug).toEqual([]);
    }
  });

  it("names no cities", () => {
    for (const candidate of CANDIDATES) {
      expect(checkText(JSON.stringify(candidate), { names: CITIES }), candidate.slug).toEqual([]);
    }
  });

  it("keeps every packshot label free of a wordmark or readable text", () => {
    for (const { slug, product } of CANDIDATES) {
      expect(product.lookDescription, slug).toMatch(/no wordmark, no readable text/i);
    }
  });

  it("sets the creative direction where the format needs it", () => {
    expect(candidateBySlug("pets-outfits")?.direction).toEqual({ look: "animation_3d", cast: "pet", energy: "auto" });
    expect(candidateBySlug("apparel-everyday")?.direction?.look).toBe("animation_3d");
    expect(candidateBySlug("apparel-everyday")?.direction).toEqual({ look: "animation_3d", cast: "auto", energy: "auto" });
  });

  it("uses 3 to 5 seeds, the US region and the Reels + TikTok format everywhere", () => {
    for (const { slug, seeds, region, platforms } of CANDIDATES) {
      expect(seeds.length, slug).toBeGreaterThanOrEqual(3);
      expect(seeds.length, slug).toBeLessThanOrEqual(5);
      expect(region, slug).toBe("United States");
      expect(platforms, slug).toBe("reels-tiktok-9x16");
    }
  });
});

describe("candidate schema", () => {
  const file = (candidates: unknown[]) => ({ version: 1, candidates });
  const valid = () => structuredClone(CANDIDATES[0]) as Record<string, unknown>;

  it("rejects duplicate slugs", () => {
    expect(() => loadCandidates(file([valid(), valid()]))).toThrow(/duplicate slug/);
  });

  it("rejects a stated customer without an adult age band", () => {
    expect(() => loadCandidates(file([{ ...valid(), statedCustomer: "Young shoppers who like basics" }]))).toThrow(/adult age band/);
    expect(() => loadCandidates(file([{ ...valid(), statedCustomer: "Shoppers, 16 to 24" }]))).toThrow(/adult age band/);
  });

  it("rejects unknown fields, bad slugs and too few seeds", () => {
    expect(() => loadCandidates(file([{ ...valid(), extra: true }]))).toThrow();
    expect(() => loadCandidates(file([{ ...valid(), slug: "Hot Sauce" }]))).toThrow(/slug/);
    expect(() => loadCandidates(file([{ ...valid(), seeds: ["One", "Two"] }]))).toThrow(/at least 3 seeds/);
  });

  it("reads adult age bands", () => {
    expect(hasAdultAgeBand("college students, 18 to 24")).toBe(true);
    expect(hasAdultAgeBand("adults 25 to 40")).toBe(true);
    expect(hasAdultAgeBand("17 to 24")).toBe(false);
    expect(hasAdultAgeBand("18 to 24 and 12 to 17")).toBe(false);
    expect(hasAdultAgeBand("young adults")).toBe(false);
  });
});
