import { describe, expect, it } from "vitest";
import type { Cast } from "../types";
import { AI_DISCLOSURE_NOTE, checklistFor, CRITIQUE_CHECKLIST, HUMAN_REVIEW_CHECKLIST, type ChecklistContext } from "./critique-checklist";

const EM_DASH = String.fromCharCode(0x2014);
const ctx = (patch: Partial<ChecklistContext> = {}, cast: Cast = "auto"): ChecklistContext => ({
  hasTalent: false,
  hasSourceImages: false,
  cast,
  ...patch,
});
const ids = (c: ChecklistContext) => checklistFor(c).map((item) => item.id);

describe("critique checklist", () => {
  it("has unique ids and no em dash", () => {
    const all = CRITIQUE_CHECKLIST.map((item) => item.id);
    expect(new Set(all).size).toBe(all.length);
    const text = [...CRITIQUE_CHECKLIST.map((i) => i.text), ...HUMAN_REVIEW_CHECKLIST, AI_DISCLOSURE_NOTE].join("\n");
    expect(text).not.toContain(EM_DASH);
  });

  it("always applies to at least one stage", () => {
    for (const item of CRITIQUE_CHECKLIST) expect(item.appliesTo.length, item.id).toBeGreaterThan(0);
  });

  it("keeps only the always items for a product-only pack without photos", () => {
    const result = checklistFor(ctx({}, "product_only"));
    expect(result.every((item) => item.when === "always")).toBe(true);
    expect(ids(ctx({}, "product_only"))).toContain("product-hero");
  });

  it("adds talent items only when there is talent", () => {
    expect(ids(ctx())).not.toContain("adults-only");
    expect(ids(ctx({ hasTalent: true }, "adult_talent"))).toEqual(expect.arrayContaining(["adults-only", "no-likeness", "tight-framing", "eyeline"]));
  });

  it("adds pet items only for pet casts", () => {
    expect(ids(ctx({}, "adult_talent"))).not.toContain("real-animals");
    expect(ids(ctx({}, "pet"))).toContain("real-animals");
  });

  it("adds the source photo match only when photos were supplied", () => {
    expect(ids(ctx())).not.toContain("matches-source");
    expect(ids(ctx({ hasSourceImages: true }))).toContain("matches-source");
  });
});

describe("human review", () => {
  it("asks for TikTok's AI-generated content label", () => {
    expect(HUMAN_REVIEW_CHECKLIST.some((line) => line.includes("TikTok's AI-generated content label"))).toBe(true);
  });

  it("says nothing auto-publishes", () => {
    expect(HUMAN_REVIEW_CHECKLIST.some((line) => /nothing auto-publishes/i.test(line))).toBe(true);
  });

  it("asks for an AI label in the disclosure note", () => {
    expect(AI_DISCLOSURE_NOTE).toMatch(/AI-generated/);
  });
});
