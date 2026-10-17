import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baselineRunSchema } from "../agent/baseline";
import { controlBrief } from "../agent/baseline-brief";
import { evidenceId } from "../evidence";
import { conceptSchema } from "../prompts/brief";
import { findFixture, readFixtureFile, recorded } from "../qloo/fixtures";
import { reportSchema } from "../report/schema";
import { cultureFieldSchema, type CultureFieldResult } from "../report/world";
import { conceptRunSchema, conceptSet } from "../stages/concepts";
import { AD_PLAN_NOTE, adPlanEntry, watchLine } from "./ad-plan";
import { CREATOR_DISCLOSURE, creatorBrief } from "./creator-brief";

// Real recorded pieces only: the hot sauce audience run, its Control and concepts, and recorded
// person and podcast insights (fixtures/probe-insights). Nothing here is hand-written Qloo data.
const report = reportSchema.parse(JSON.parse(readFileSync("data/runs/food-hot-sauce/audience.report.json", "utf8")));
const segment = report.audience.segments!.items[0];
const run = baselineRunSchema.parse(JSON.parse(readFileSync("data/baselines/food-hot-sauce/run-1.json", "utf8")));
const brief = controlBrief(run);
const concepts = conceptSet(conceptRunSchema.parse(JSON.parse(readFileSync("data/baselines/food-hot-sauce/concepts.json", "utf8"))), brief);
const kept = concepts.best.concept;

const insights = readFixtureFile(findFixture("probe-insights") as string);
function sources(id: string, take: number) {
  const request = recorded(insights, id);
  const entities = (request.body as { results: { entities: { entity_id: string; name: string; subtype?: string }[] } }).results.entities;
  return entities.slice(0, take).map((entity, index) => ({
    kind: "entity" as const,
    id: entity.entity_id,
    name: entity.name,
    type: entity.subtype ?? "",
    rank: index + 1,
    position: null,
    why: [],
    evidenceIds: [evidenceId(request.endpoint, request.params)],
  }));
}
const creators: CultureFieldResult = cultureFieldSchema.parse({
  field: "creators",
  signal: "rich",
  scope: "audience",
  sources: [...sources("person-take20", 3), ...sources("podcast-take20", 2)],
  cues: [],
});

describe("adPlanEntry", () => {
  const entry = (concept = kept) =>
    adPlanEntry({ label: segment.label, ageBands: [segment.bucket], cities: segment.cities, concept, evidenceIds: segment.evidenceIds });

  it("groups by concept world, with ages and cities as optional geo options and their receipts", () => {
    const plan = entry();
    expect(plan.name).toBe(`${segment.label}: ${kept.title}`);
    expect(plan.ageBands).toEqual([segment.bucket]);
    expect(plan.cities).toEqual(segment.cities.slice(0, 5).map((c) => c.label));
    expect(plan.note.startsWith(AD_PLAN_NOTE)).toBe(true);
    expect(plan.note).toMatch(/optional: use them only where a campaign allows them/);
    for (const id of [...segment.evidenceIds, ...segment.cities[0].evidenceIds]) expect(plan.evidenceIds).toContain(id);
  });

  it("ties what to watch to the kept concept's test hypothesis, and never promises a result", () => {
    const tested = conceptSchema.parse({ ...kept, testHypothesis: "whether a four-meal montage beats a single slow drip for this world." });
    expect(entry(tested).watch).toBe(
      "Watch whether a four-meal montage beats a single slow drip for this world. Compare this ad set (Meta) or ad group (TikTok) with the other worlds' on the same objective and budget.",
    );
    // Concepts written before test hypotheses fall back to the concept itself.
    expect(watchLine(kept)).toMatch(/^Watch how "Four Meals, One Bottle" does against the other worlds' concepts\./);
    for (const text of [entry().watch, entry().note, entry(tested).watch]) expect(text).not.toMatch(/\b(?:guarantee|will (?:sell|convert|win)|results in)\b/i);
  });

  it("orders age bands like Qloo, drops duplicates, and refuses a city without a receipt", () => {
    const plan = adPlanEntry({ label: segment.label, ageBands: ["35_to_44", "25_to_29", "35_to_44"], cities: [], concept: kept, evidenceIds: segment.evidenceIds });
    expect(plan.ageBands).toEqual(["25_to_29", "35_to_44"]);
    expect(() => adPlanEntry({ label: segment.label, ageBands: [], cities: [{ label: "Austin", evidenceIds: [] }], concept: kept, evidenceIds: segment.evidenceIds })).toThrow(/no receipt/);
    expect(() => adPlanEntry({ label: segment.label, ageBands: [], cities: [], concept: kept, evidenceIds: [] })).toThrow();
  });
});

describe("creatorBrief", () => {
  const made = creatorBrief({ brief, creators, concepts });

  it("profiles the creator to recruit as an interpreted cue with the creators' receipts, naming no one", () => {
    expect(made).not.toBeNull();
    const profile = made!.profile;
    expect(profile.origin).toBe("interpreted");
    expect(profile.evidenceIds.length).toBeGreaterThan(0);
    for (const source of creators.sources) expect(profile.evidenceIds).toEqual(expect.arrayContaining(source.evidenceIds));
    for (const source of creators.sources) expect(profile.text).not.toContain(source.name);
    expect(profile.text).toMatch(/Qloo measured an affinity for 3 people and 2 podcasts/);
    expect(profile.text).toMatch(/whole taste neighborhood/);
    expect(profile.text).toMatch(/never someone asked to imitate a real person/);
  });

  it("uses the culture stage's own creator wording only when it names no one", () => {
    const named = cultureFieldSchema.parse({ ...creators, cues: [{ text: `Hosts like ${creators.sources[0].name}`, origin: "interpreted", evidenceIds: creators.sources[0].evidenceIds }] });
    expect(creatorBrief({ brief, creators: named, concepts })!.profile.text).not.toContain(creators.sources[0].name);
    const plain = cultureFieldSchema.parse({ ...creators, cues: [{ text: "Conversational long-form hosts who cook on camera", origin: "interpreted", evidenceIds: creators.sources[0].evidenceIds }] });
    expect(creatorBrief({ brief, creators: plain, concepts })!.profile.text).toMatch(/^Conversational long-form hosts who cook on camera\. Recruit someone/);
  });

  it("takes 3 hooks from the concepts, details to hit from the brief and to avoid from its avoid list", () => {
    expect(made!.hooks).toEqual([kept.hook, ...concepts.others.filter((c) => c.status === "ranked").map((c) => c.concept.hook)].slice(0, 3));
    // Every brief field fits: three settings plus wardrobe never push out the music or the look.
    expect(brief.setting).toHaveLength(3);
    expect(made!.hit).toEqual([
      `Mood: ${brief.mood.text}`,
      `Voice: ${brief.voice.tone.text}`,
      `Music feel: ${brief.music.text}`,
      `Look: ${brief.visual.text}`,
      `Settings: ${brief.setting.map((cue) => cue.text).join("; ")}`,
      `Wardrobe: ${brief.wardrobe!.text}`,
    ]);
    expect(made!.avoid).toEqual([...brief.voice.avoid, "Copying a real person's look or voice, and any third-party logo"].slice(0, 6));
    expect(made!.disclosure).toBe(CREATOR_DISCLOSURE);
    expect(made!.disclosure).toMatch(/in the video itself, out loud and on screen: "ad" or #ad works/);
  });

  it("is null without creator sources, and refuses another field", () => {
    expect(creatorBrief({ brief, creators: null, concepts })).toBeNull();
    const none = cultureFieldSchema.parse({ field: "creators", signal: "none", scope: "audience", sources: [], cues: [] });
    expect(creatorBrief({ brief, creators: none, concepts })).toBeNull();
    expect(() => creatorBrief({ brief, creators: { ...creators, field: "music" }, concepts })).toThrow(/creators field/);
  });
});
