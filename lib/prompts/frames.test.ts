// The storyboard frame template on the hot sauce example's recorded packs: which scenes get a frame,
// which photo is the reference, and that every frame carries the brief and the closing rules.
import { describe, expect, it } from "vitest";
import { checkText, FAMOUS_PLACES } from "../guardrails";
import { reportNames } from "../stages/after-run";
import { exampleReport } from "../stages/fixture-run";
import { buildFramePrompt, frameBody, frameReference, frameScenes, FRAMES_PER_WORLD } from "./frames";
import { FRAME_MODELS } from "./models.config";

const report = exampleReport();
const names = reportNames(report);
const scenes = (visible: boolean[]) => visible.map((productVisible) => ({ productVisible }));

describe("frameScenes", () => {
  it("frames every scene of a short concept", () => {
    expect(frameScenes(scenes([true, false, true]))).toEqual([0, 1, 2]);
    expect(frameScenes(scenes([true, false, false, true]))).toEqual([0, 1, 2, 3]);
  });

  it("keeps the hook and the payoff, then the scenes between that show the product", () => {
    expect(frameScenes(scenes([false, false, true, false, true]))).toEqual([0, 1, 2, 4]);
    expect(frameScenes(scenes([false, false, false, true, true]))).toEqual([0, 1, 3, 4]);
    expect(frameScenes(scenes([false, true, true, true, false]))).toEqual([0, 1, 2, 4]);
    expect(frameScenes(scenes([true, true, true, true, true])).length).toBe(FRAMES_PER_WORLD);
  });
});

describe("frameReference", () => {
  it("takes the first product-only photo and never one that shows a person", () => {
    const images = (list: [string, boolean][]) => ({ ...report.inputs.product, source: { kind: "images" as const, images: list.map(([url, showsPerson]) => ({ url, showsPerson })) } });
    expect(frameReference(images([["https://a.example/person.jpg", true], ["https://a.example/bottle.jpg", false]]))).toBe("https://a.example/bottle.jpg");
    expect(frameReference(report.inputs.product)).toBeNull();
  });
});

describe.each(report.worlds.map((w) => [w.segmentId, w] as const))("frames for %s", (_, world) => {
  const pack = world.pack!;
  const brief = world.brief!;
  const product = report.inputs.product;

  it("carries the scene, the setting, the styling, the visual language and the mood, never the overlay text", () => {
    for (const sceneIndex of frameScenes(pack.concept.scenes)) {
      const { prompt } = buildFramePrompt({ pack, brief, product, sceneIndex });
      expect(prompt).toContain(pack.concept.scenes[sceneIndex].action.replace(/[.!?]$/, ""));
      for (const cue of [brief.setting[0].text, brief.visual.text, brief.mood.text]) expect(prompt.toLowerCase()).toContain(cue.replace(/[.!?]$/, "").toLowerCase().slice(0, 40));
      if (brief.wardrobe) expect(prompt).toContain(brief.wardrobe.text.replace(/[.!?]$/, "").slice(0, 40));
      const overlay = pack.concept.scenes[sceneIndex].overlayText;
      if (overlay) expect(prompt).not.toContain(overlay);
    }
  });

  it("ends with the closing rules and passes the guardrails with every name the run knows", () => {
    for (const sceneIndex of frameScenes(pack.concept.scenes)) {
      const plan = buildFramePrompt({ pack, brief, product, sceneIndex });
      expect(plan.model).toBe(FRAME_MODELS.text);
      expect(plan.prompt).toContain(`The ${product.name} looks like this:`);
      expect(plan.prompt).toContain("Every person in frame is a clearly adult, original fictional character");
      expect(plan.prompt).toContain("No children, no school settings.");
      expect(checkText(plan.prompt, { names: [...names, ...FAMOUS_PLACES], allowedNames: [...brief.allowedPlaces, product.brandName ?? ""], exactCaseNames: true })).toEqual([]);
    }
  });

  it("hashes what is sent: a rewrite or another model is another frame", () => {
    const input = { pack, brief, product, sceneIndex: 0 };
    const plan = buildFramePrompt(input);
    expect(buildFramePrompt(input).promptHash).toBe(plan.promptHash);
    expect(buildFramePrompt(input, `${frameBody(input)} Closer.`).promptHash).not.toBe(plan.promptHash);
    const withPhoto = { ...product, source: { kind: "images" as const, images: [{ url: "https://a.example/bottle.png", showsPerson: false }] } };
    const edit = buildFramePrompt({ ...input, product: withPhoto });
    expect(edit.model).toBe(FRAME_MODELS.edit);
    expect(edit.referenceUrls).toEqual(["https://a.example/bottle.png"]);
    expect(edit.prompt).toContain("Use the reference photo as the exact");
    expect(edit.promptHash).not.toBe(plan.promptHash);
  });
});
