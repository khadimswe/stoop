import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { baselineRunSchema } from "../../agent/baseline";
import { candidateProduct, controlBrief } from "../../agent/baseline-brief";
import { candidateBySlug } from "../../demo/candidates";
import { kitSchema, UGC_FORMATS, type UgcScript } from "../../report/world";
import { conceptRunSchema } from "../../stages/concepts";
import { conceptSchema, productSpecSchema, type Concept } from "../brief";
import { conceptCaptions, vttTime } from "./captions";
import { CTA_LABELS, UGC_FORMAT_SPECS } from "./formats";
import { ARCADS_MAX_CHARS, buildKitScripts, pickUgcFormat, proofLine } from "./index";

// Real recorded pieces only: each candidate's Control run 1 and the concepts written from it.
const control = (slug: string) => {
  const candidate = candidateBySlug(slug)!;
  const run = baselineRunSchema.parse(JSON.parse(readFileSync(`data/baselines/${slug}/run-1.json`, "utf8")));
  const concepts = conceptRunSchema.parse(JSON.parse(readFileSync(`data/baselines/${slug}/concepts.json`, "utf8")));
  return { product: candidateProduct(candidate), brief: controlBrief(run), concepts: concepts.concepts.map((c) => c.concept), best: concepts.concepts[concepts.bestIndex].concept };
};
const hot = control("food-hot-sauce");

const withScenes = (concept: Concept, patch: (scene: Concept["scenes"][number], index: number) => Partial<Concept["scenes"][number]>): Concept =>
  conceptSchema.parse({ ...concept, scenes: concept.scenes.map((scene, index) => ({ ...scene, ...patch(scene, index) })) });

describe("pickUgcFormat", () => {
  it("picks each real Control concept's format from its own words, with a reason", () => {
    const picks = (slug: string) => control(slug).concepts.map((c) => pickUgcFormat(c).format.id);
    expect(picks("food-hot-sauce")).toEqual(["first_try", "first_try", "first_try"]);
    expect(picks("care-kit-sneakers")).toEqual(["before_after", "before_after", "before_after"]);
    expect(picks("care-moisturizer")).toEqual(["product_demo", "problem_solution", "problem_solution"]);
    expect(picks("food-coffee")).toEqual(["product_demo", "unboxing", "product_demo"]);
    const sneakers = pickUgcFormat(control("care-kit-sneakers").concepts[0]);
    expect(sneakers.matched).toEqual(expect.arrayContaining(["scuffed", "split screen"]));
    expect(sneakers.reason).toMatch(/^Before and after: the concept's own words point to it \("/);
  });

  it("falls back to a product demo, and never needs an LLM call", () => {
    const pick = pickUgcFormat(control("home-candles").concepts[0]);
    expect(pick).toMatchObject({ format: { id: "product_demo" }, matched: [] });
    expect(pick.reason).toMatch(/the product is on screen in 4 of 5 scenes/);
  });

  it("counts a hook match double, so one word in the hook is enough", () => {
    const pov = withScenes(hot.best, (_, index) => (index === 0 ? { camera: "object_pov" } : {}));
    // The hook's camera reads "Object POV": 2 points, against first try's 2, and POV wins the tie.
    expect(pickUgcFormat(pov).format.id).toBe("pov");
  });

  it("covers every contract format and none of them is a testimonial", () => {
    expect(Object.keys(UGC_FORMAT_SPECS).sort()).toEqual([...UGC_FORMATS].sort());
    for (const spec of Object.values(UGC_FORMAT_SPECS)) expect(`${spec.label} ${spec.hookType} ${spec.demoBeat}`).not.toMatch(/testimonial|review/i);
  });
});

describe("buildKitScripts", () => {
  const kit = buildKitScripts({ product: hot.product, brief: hot.brief, concept: hot.best });
  const script = (platform: UgcScript["platform"], tool: UgcScript["tool"]) => kit.ugc.find((s) => s.platform === platform && s.tool === tool)!.script;

  it("writes one script per platform and tool, and fits the kit contract", () => {
    expect(kit.ugc.map((s) => `${s.platform}/${s.tool}`)).toEqual(["meta/arcads", "meta/creatify", "meta/creator", "tiktok/arcads", "tiktok/creatify", "tiktok/creator"]);
    expect(kitSchema.parse({ ...kit, adPlan: null, creatorBrief: null })).toBeTruthy();
  });

  it("gives a customer-voice format to human creators only, and the product demo to AI actors", () => {
    // A first try by an AI actor would show a person who does not exist trying the product (FTC, Aug 2024).
    expect(kit.ugc.map((s) => [s.tool, s.format])).toEqual([
      ["arcads", "product_demo"],
      ["creatify", "product_demo"],
      ["creator", "first_try"],
      ["arcads", "product_demo"],
      ["creatify", "product_demo"],
      ["creator", "first_try"],
    ]);
    const pick = pickUgcFormat(hot.best);
    expect(pick).toMatchObject({ format: { id: "first_try" }, aiFormat: { id: "product_demo" } });
    expect(pick.reason).toMatch(/only a human creator gets it; AI-actor tools get the product demo/);
    expect(script("meta", "creator")).toContain("Format: First try (TikTok hook)");
    expect(script("meta", "arcads")).toContain("Format: Product demo (Meta-friendly)");
    // Unboxing reads as opening one's own order, so it goes the same way.
    expect(UGC_FORMAT_SPECS.unboxing.customerVoice).toBe(true);
    const sneakers = control("care-kit-sneakers");
    const before = buildKitScripts({ product: sneakers.product, brief: sneakers.brief, concept: sneakers.best });
    expect(new Set(before.ugc.map((s) => s.format))).toEqual(new Set(["before_after"]));
  });

  it("checks real names the way the pack check does", () => {
    // The concept's own payoff line names no one; a seed or reference name that slipped into it is refused.
    const named = withScenes(hot.best, (_, index) => (index === 4 ? { dialogue: "Better than Trader Joe's." } : {}));
    expect(() => buildKitScripts({ product: hot.product, brief: hot.brief, concept: named, names: ["Trader Joe's"] })).toThrow(/real name/);
    expect(() => buildKitScripts({ product: hot.product, brief: hot.brief, concept: hot.best, names: ["Trader Joe's"] })).not.toThrow();
  });

  it("keeps the Arcads script under 1,000 characters, dropping the proof line first", () => {
    const long = withScenes(hot.best, (scene, index) => (index > 0 ? { dialogue: `${"A slow, steady drizzle over the eggs. ".repeat(11)}${index}` } : {}));
    const arcads = buildKitScripts({ product: hot.product, brief: hot.brief, concept: long }).ugc.find((s) => s.tool === "arcads")!.script;
    const spoken = arcads.split("What the actor should say:\n")[1].split("\n\n")[0];
    expect(spoken.length).toBeLessThan(ARCADS_MAX_CHARS);
    expect(spoken).not.toContain(hot.product.oneLine);
  });

  it("uses each ads manager's own CTA wording", () => {
    expect(kit.ugc.filter((s) => s.platform === "meta").every((s) => s.cta === CTA_LABELS.shop_now.meta)).toBe(true);
    expect(kit.ugc.filter((s) => s.platform === "tiktok").every((s) => s.cta === "Shop Now")).toBe(true);
    expect(script("meta", "arcads")).toContain("CTA button: Shop now");
  });

  it("formats Arcads as quoted sentences with breaks, under its character limit", () => {
    const arcads = script("meta", "arcads");
    const spoken = arcads.split("What the actor should say:\n")[1].split("\n\n")[0];
    expect(spoken.split("\n")).toEqual([
      '"Your eggs called. They want a better hot sauce." <break time="0.5s" />',
      '"Garlic. Fermented chile. A little fruit." <break time="0.5s" />',
      '"A fermented red chile hot sauce made in small batches with garlic and a little fruit for sweetness." <break time="0.5s" />',
      '"Heat that waits a second. Try the bottle."',
    ]);
    expect(spoken.length).toBeLessThan(1500);
    expect(arcads).toContain("Before posting: add Meta's AI label where it applies.");
    expect(script("tiktok", "arcads")).toContain("turn on TikTok's AI-generated content label");
  });

  it("gives Creatify one scene per beat and the creator a shot list with the FTC disclosure", () => {
    expect(script("meta", "creatify").match(/^Scene \d \(/gm)).toHaveLength(4);
    expect(script("meta", "creatify")).toContain("aspect ratio 9x16");
    const creator = script("tiktok", "creator");
    expect(creator).toMatch(/say and show "ad" in the video itself \(#ad works\)/);
    expect(creator).toContain("not as your own review");
    expect(creator).toContain("Stay away from: Macho heat challenges or pain jokes");
  });

  it("speaks as the brand, describes the actor without ethnicity, and proves only with the seller's words", () => {
    for (const { script: text } of kit.ugc) {
      expect(text).not.toMatch(/\bI (?:tried|love|use|bought|was)\b|\bmy (?:favorite|go-to)\b/i);
      expect(text).toContain(hot.product.oneLine);
    }
    expect(script("meta", "arcads")).toMatch(/an original AI actor, an adult in one of these age bands: 25 to 29, 30 to 34, 35 to 44, styled as: casual home-cook looks/);
    expect(script("meta", "arcads")).toContain("never a customer giving a review");
  });

  it("drops a proof line that makes a claim the kit cannot use", () => {
    const boasting = productSpecSchema.parse({ ...hot.product, oneLine: "Our best seller, loved by thousands of customers." });
    expect(proofLine(boasting)).toBeNull();
    const scripts = buildKitScripts({ product: boasting, brief: hot.brief, concept: hot.best });
    for (const { script: text } of scripts.ugc) expect(text).not.toMatch(/best seller|thousands/i);
  });

  it("refuses a brief whose styling breaks the guardrails", () => {
    const wardrobe = { text: "a school uniform and a backpack", origin: "creative" as const, evidenceIds: [] };
    expect(() => buildKitScripts({ product: hot.product, brief: { ...hot.brief, wardrobe }, concept: hot.best })).toThrow(/breaks the guardrails/);
  });
});

describe("captions", () => {
  it("time a cue to each scene's line and overlay, overlays near the top", () => {
    const vtt = conceptCaptions(hot.best) as string;
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("scene-1-voice\n00:00:00.000 --> 00:00:03.000\nYour eggs called. They want a better hot sauce.");
    expect(vtt).toContain("scene-1-text\n00:00:00.000 --> 00:00:03.000 line:10%\nYour eggs called.");
    expect(vtt).toContain("scene-5-voice\n00:00:12.000 --> 00:00:15.000\nHeat that waits a second. Try the bottle.");
    expect(vttTime(75.5)).toBe("00:01:15.500");
  });

  it("skip an overlay that repeats the line, escape markup, and are null with nothing to say or show", () => {
    const repeated = withScenes(hot.best, (_, index) => (index === 0 ? { dialogue: "Salt & heat <3", overlayText: "Salt & heat <3" } : {}));
    const vtt = conceptCaptions(repeated) as string;
    expect(vtt).toContain("scene-1-voice\n00:00:00.000 --> 00:00:03.000\nSalt &amp; heat &lt;3");
    expect(vtt).not.toContain("scene-1-text");
    const silent = withScenes(hot.best, () => ({ dialogue: null, overlayText: null }));
    expect(conceptCaptions(silent)).toBeNull();
    expect(buildKitScripts({ product: hot.product, brief: hot.brief, concept: silent }).captions).toBeNull();
  });
});
