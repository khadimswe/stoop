import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmitter } from "../events";
import { referenceSets } from "../geo/reference";
import { createRunContext } from "../qloo/context";
import type { Proof, Report } from "../report/schema";
import { replayClient } from "../demo/example-run";
import type { StageEnv } from "./env";
import { genericDiffers, measuredGender, realityCheck, statedFromText, type StatedAudience } from "./gap";

const report = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/audience.report.json`, "utf8")) as Report;
const sauce = report("food-hot-sauce");
const candles = report("home-candles");
const sauceProof = sauce.audience.proof as Proof;

function env(): StageEnv & { events: ReturnType<typeof createEmitter>["events"] } {
  const emitter = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
  return {
    client: replayClient(),
    ctx: createRunContext({ runId: "gap-test", cap: 10 }),
    emit: emitter.emit,
    reference: referenceSets(),
    inReference: referenceSets().full.members.includes("candidate--food-hot-sauce"),
    events: emitter.events,
  };
}

const check = (proof: Proof, stated: StatedAudience | null, seeds = sauce.inputs.seeds) => realityCheck(env(), { seeds, proof, stated, site: null, generic: null });

describe("reading a stated customer", () => {
  it("keeps the band as written and maps it to Qloo buckets", () => {
    expect(statedFromText("Home cooks who put hot sauce on almost everything, 25 to 40.")).toMatchObject({
      band: "25 to 40",
      ages: ["25_to_29", "30_to_34", "35_to_44"],
      gender: null,
      place: null,
    });
  });

  it("reads gender words, and never takes a place from the run's region", () => {
    // The heatmap is already limited to the region, so a region "place" would always confirm.
    expect(statedFromText("Busy moms, 30 to 45")).toMatchObject({ gender: "female", place: null });
  });
});

describe("the Reality Check never forces a gap", () => {
  it("confirms a founder who read the audience right, then moves to what they didn't say", async () => {
    const result = await check(sauceProof, statedFromText("Hot sauce fans, 55 to 70"));
    expect(result.outcome).toBe("confirmed");
    const kinds = result.lines.map((l) => l.kind);
    expect(kinds).toEqual(["stated", "confirmed", "unstated"]);
    expect(result.lines[1].text).toMatch(/^Your read is right: Qloo measures the same/);
    expect(result.lines[2].text).toMatch(/clusters around Slidell, LA/);
  });

  it("is partly when one stated dimension holds and another doesn't", async () => {
    // Hot sauce skews 55 and older (confirmed) but is gender-balanced (0.08), so "mostly women" is a near tie.
    const result = await check(sauceProof, statedFromText("Women who love heat, 55 to 70"));
    expect(result.dimensions.find((d) => d.dimension === "gender")?.outcome).toBe("near_tie");
    expect(result.outcome).toBe("partly");
  });

  it("calls a clear gender mismatch a gap", async () => {
    // Candles skew female at 0.63.
    expect(measuredGender((candles.audience.proof as Proof).demographics.gender)).toBe("female");
    const result = await check(candles.audience.proof as Proof, statedFromText("Men who unwind after work, 28 to 45"), candles.inputs.seeds);
    expect(result.dimensions.find((d) => d.dimension === "gender")?.outcome).toBe("gap");
  });

  it("checks a stated state or city against the top 10 by lift: confirmed in the top 5, a near tie at 6 to 10", async () => {
    const inLouisiana = await check(sauceProof, { ...statedFromText("Cooks in the South, 25 to 40"), place: "Louisiana" });
    expect(inLouisiana.dimensions.find((d) => d.dimension === "cities")).toMatchObject({ outcome: "confirmed", margin: 1 });
    const seventh = sauceProof.cityRanks.find((c) => c.rank === 7) as { label: string };
    const near = await check(sauceProof, { ...statedFromText("Cooks, 25 to 40"), place: seventh.label.split(", ")[0] });
    expect(near.dimensions.find((d) => d.dimension === "cities")).toMatchObject({ outcome: "near_tie", margin: 7 });
  });

  it("counts a bucket as stated only with real overlap: 25 to 45 does not state 45 to 54", async () => {
    const bike = JSON.parse(readFileSync("data/data-check/summary.json", "utf8")).candidates.find((c: { slug: string }) => c.slug === "startup-bike-light");
    expect(bike.age.statedBuckets).toEqual(["25_to_29", "30_to_34", "35_to_44"]);
    expect(bike.gap.age).toBe(true);
  });

  it("treats a broad band as a weak match, never a full confirmation", async () => {
    const result = await check(sauceProof, statedFromText("Anyone who likes heat, 18 to 70"));
    expect(result.dimensions.find((d) => d.dimension === "age")).toMatchObject({ outcome: "confirmed", broad: true });
    expect(result.outcome).toBe("partly");
    expect(result.lines.some((l) => l.kind === "broad" && /is broad, so a match says little/.test(l.text))).toBe(true);
  });

  it("calls a stated taste Qloo didn't score unverifiable, not a near tie", async () => {
    // Gate 2's recorded tone call for the hot sauce: Qloo did not return "Warm".
    const stated = { ...statedFromText("Hot sauce fans, 25 to 40"), tags: [{ id: "urn:tag:emotional_tone:qloo:warm", name: "Warm", kind: "tone" as const }] };
    const result = await check(sauceProof, stated);
    expect(result.dimensions.find((d) => d.dimension === "taste")).toMatchObject({ outcome: "unverifiable", position: null });
    expect(result.lines.some((l) => l.kind === "unverifiable" && /no measurable affinity for Warm, which is not evidence either way/.test(l.text))).toBe(true);
    // Unverifiable doesn't count toward the outcome: the age gap decides it.
    expect(result.outcome).toBe("gap");
  });

  it("scores stated taste against the tag panel in one recorded call", async () => {
    // The hot sauce Control's music, "funk-soul", mapped to Qloo's "Soul - Funk" in Gate 2.
    const stated = { ...statedFromText("Hot sauce fans, 25 to 40"), tags: [{ id: "urn:tag:genre:music:soul_funk", name: "Soul - Funk", kind: "music" as const }] };
    const result = await check(sauceProof, stated);
    const taste = result.dimensions.find((d) => d.dimension === "taste");
    expect(taste?.outcome).toBe("gap");
    expect(taste?.position).toEqual({ tag: "Soul - Funk", beats: 0, of: expect.any(Number) });
  });

  it("shows the generic brief when it differs, even if the founder matched", () => {
    expect(genericDiffers(sauceProof, { ages: ["25_to_29", "30_to_34", "35_to_44"], gender: "balanced", cities: ["Austin", "Portland"] })).toBe(true);
    expect(genericDiffers(sauceProof, { ages: ["55_and_older"], gender: "balanced", cities: ["Slidell"] })).toBe(false);
  });
});
