import { describe, expect, it } from "vitest";
import { checkText, FAMOUS_PLACES } from "../guardrails";
import { POSTER_MODEL } from "../prompts/models.config";
import { BRAND_WORDS, buildPosterPrompt, checkPosterPrompt, DEFAULT_ENERGY, POSTER_EXCLUSIONS, posterFeeling, STYLE_ENERGY, visualEnergy } from "./poster-prompt";
import { samplePlanReport } from "./posts-fixture";
import type { PlanReport } from "./schema";

const EM_DASH = String.fromCharCode(0x2014);

/** The sample with its kept concept's title and hook replaced. */
function withConcept(report: PlanReport, patch: { title?: string; hook?: string }): PlanReport {
  const plan = report.plan!;
  return { ...report, plan: { ...plan, concepts: plan.concepts.map((c) => (c.id === plan.conceptId ? { ...c, ...patch } : c)) } };
}

describe("buildPosterPrompt", () => {
  const report = samplePlanReport();
  const { prompt, promptHash, input } = buildPosterPrompt(report);

  it("never names an artist, place, store, city, carrier or brand", () => {
    const lower = prompt.toLowerCase();
    for (const artist of report.local.city!.artists) expect(lower).not.toContain(artist.name.toLowerCase());
    for (const place of report.local.block!.places) expect(lower).not.toContain(place.name.toLowerCase());
    expect(lower).not.toContain(report.inputs.store.name.toLowerCase());
    expect(prompt).not.toContain(report.inputs.store.city);
    for (const word of BRAND_WORDS) expect(prompt).not.toContain(word);
    expect(checkText(prompt, { names: [...FAMOUS_PLACES] })).toEqual([]);
  });

  it("carries no text to paint: no offers, dates, times, prices, numbers or quotes before the exclusions", () => {
    const body = prompt.slice(0, -POSTER_EXCLUSIONS.length);
    for (const offer of report.inputs.offers) expect(prompt).not.toContain(offer.text);
    expect(body).not.toMatch(/\d/);
    expect(body).not.toMatch(/["“”$]/);
    expect(body).not.toMatch(/\b(?:logo|poster|flyer|lettering|typography|headline|slogan)\b/i);
  });

  it("ends with the exclusions: no text, no logos, no people", () => {
    expect(prompt.endsWith(POSTER_EXCLUSIONS)).toBe(true);
    expect(POSTER_EXCLUSIONS).toMatch(/No text/);
    expect(POSTER_EXCLUSIONS).toMatch(/no logos/);
    expect(POSTER_EXCLUSIONS).toMatch(/no people/);
    expect(POSTER_EXCLUSIONS).toMatch(/no faces/);
  });

  it("passes its own check and the shared guardrails", () => {
    expect(checkPosterPrompt(prompt, report)).toEqual([]);
    expect(prompt).not.toContain(EM_DASH);
  });

  it("turns the city's music styles into visual energy, never the genre names", () => {
    const energies = visualEnergy(report);
    expect(energies).toHaveLength(2);
    for (const energy of energies) expect(prompt).toContain(energy);
    expect(prompt).not.toMatch(/\btrap\b|r&b|hip hop/i);
  });

  it("falls back to the default energy when no style matches", () => {
    const quiet = { ...report, local: { ...report.local, city: { ...report.local.city!, styles: [], artists: [] } } };
    expect(visualEnergy(quiet)).toEqual([DEFAULT_ENERGY]);
    expect(visualEnergy({ ...report, local: { ...report.local, city: null } })).toEqual([DEFAULT_ENERGY]);
  });

  it("reads the artists' genres when Qloo returned no styles", () => {
    const genresOnly = { ...report, local: { ...report.local, city: { ...report.local.city!, styles: [] } } };
    expect(visualEnergy(genresOnly)[0]).toBe(STYLE_ENERGY.find((r) => r.match.test("Trap"))!.energy);
  });

  it("freezes the prompt with a stable hash over the model, settings and prompt", () => {
    expect(promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(buildPosterPrompt(samplePlanReport()).promptHash).toBe(promptHash);
    expect(input).toEqual({ prompt, num_images: 1, aspect_ratio: POSTER_MODEL.aspectRatio, resolution: POSTER_MODEL.resolution, output_format: "png" });
    const other = buildPosterPrompt({ ...report, inputs: { ...report.inputs, startTime: "19:00" } });
    expect(other.promptHash).not.toBe(promptHash);
  });
});

describe("posterFeeling", () => {
  const report = samplePlanReport();

  it("keeps the hook as the feeling, refs removed", () => {
    expect(posterFeeling(withConcept(report, { hook: "Tacos from [[place-taqueria]] and the city's own sound." }))).toBe("tacos and the city's own sound");
  });

  it("drops a hook that names a place, the store, a carrier or a number, then tries the title", () => {
    expect(posterFeeling(withConcept(report, { hook: "Tacos from Taqueria Fixture Grande all day." }))).toBe("taco table saturday");
    expect(posterFeeling(withConcept(report, { hook: "Big day at Corner Wireless on Fifth.", title: "Metro Saturday" }))).toBeNull();
    expect(posterFeeling(withConcept(report, { hook: "Two for $25 at the table.", title: "Saturday at 12" }))).toBeNull();
    expect(posterFeeling(withConcept(report, { hook: "Music for the kids on the block.", title: "Taco Table" }))).toBe("taco table");
  });

  it("never lets a named hook into the prompt", () => {
    const named = withConcept(report, { hook: "Tacos from Taqueria Fixture Grande, two blocks over.", title: "Velvet Testline Night" });
    const { prompt } = buildPosterPrompt(named);
    expect(prompt).not.toMatch(/Taqueria Fixture Grande|Velvet Testline/);
    expect(checkPosterPrompt(prompt, named)).toEqual([]);
  });
});

describe("checkPosterPrompt", () => {
  const report = samplePlanReport();
  const ok = buildPosterPrompt(report).prompt;

  it("refuses a prompt that asks for text, logos or people, or names anything", () => {
    const head = (extra: string) => `${extra} ${POSTER_EXCLUSIONS}`;
    expect(checkPosterPrompt(head("A poster with the store logo."), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(head("A crowd of people dancing."), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(head("Art in the mood of Velvet Testline."), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(head("Saturday, November 7."), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(head('The word "tacos" in neon.'), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(head("A T-Mobile magenta wash."), report).length).toBeGreaterThan(0);
    expect(checkPosterPrompt(ok.replace(POSTER_EXCLUSIONS, ""), report).length).toBeGreaterThan(0);
  });
});
