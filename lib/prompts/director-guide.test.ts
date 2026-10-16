import { describe, expect, it } from "vitest";
import { AI_DISCLOSURE_NOTE, checklistFor, HUMAN_REVIEW_CHECKLIST } from "./critique-checklist";
import { renderDirectorGuide, type DirectorGuideInput } from "./director-guide";
import { getModel, MODELS, type ModelConfig } from "./models.config";

const EM_DASH = String.fromCharCode(0x2014);
const checklist = checklistFor({ hasTalent: true, hasSourceImages: true, cast: "adult_talent" });
const input = (patch: Partial<DirectorGuideInput> = {}): DirectorGuideInput => ({
  imageModel: getModel("nano-banana-pro"),
  draftModel: getModel("seedance-2-5"),
  finalModel: getModel("seedance-2-5"),
  checklist,
  takesPerPrompt: 1,
  maxRevisions: 1,
  ...patch,
});
const fake = (base: ModelConfig, displayName: string, draftSetting: string, finalSetting: string): ModelConfig => ({
  ...base,
  displayName,
  draftSetting,
  finalSetting,
});

describe("director's guide", () => {
  it("lists every section in order", () => {
    const guide = renderDirectorGuide(input());
    const headings = ["## 1. Assets first", "## 2. Draft", "## 3. Check", "## 4. Revise", "## 5. Final", "## 6. Edit", "## Fairness", "## Rules", "## Before you post"];
    const positions = headings.map((h) => guide.indexOf(h));
    for (const [index, position] of positions.entries()) expect(position, headings[index]).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("prints every checklist item and the human review list as checkboxes", () => {
    const guide = renderDirectorGuide(input());
    for (const item of checklist) expect(guide).toContain(`- [ ] ${item.text}`);
    for (const line of HUMAN_REVIEW_CHECKLIST) expect(guide).toContain(`- [ ] ${line}`);
    expect(guide).toContain(AI_DISCLOSURE_NOTE);
  });

  it("takes model names and settings only from the configs passed in", () => {
    const image = fake(getModel("nano-banana-pro"), "Image Model A", "draft-res-a", "final-res-a");
    const draft = fake(getModel("veo-3-1-fast"), "Draft Model B", "draft-res-b", "final-res-b");
    const final = fake(getModel("veo-3-1"), "Final Model C", "draft-res-c", "final-res-c");
    const guide = renderDirectorGuide(input({ imageModel: image, draftModel: draft, finalModel: final }));
    for (const text of ["Image Model A", "draft-res-a", "final-res-a", "Draft Model B", "draft-res-b", "Final Model C", "final-res-c"]) {
      expect(guide).toContain(text);
    }
    for (const model of Object.values(MODELS)) expect(guide).not.toContain(model.displayName);
  });

  it("includes the per-scene model when one is given", () => {
    const veo = getModel("veo-3-1");
    const guide = renderDirectorGuide(input({ perSceneModel: veo }));
    expect(guide).toContain(`${veo.displayName} at ${veo.draftSetting}`);
    expect(guide).toContain(`${veo.displayName} at ${veo.finalSetting}`);
  });

  it("states the fairness rules and never publishes", () => {
    const guide = renderDirectorGuide(input());
    expect(guide).toContain("same model, settings, number of takes and revisions");
    expect(guide).toContain("Pick takes by the checklist only.");
    expect(guide.toLowerCase()).toContain("never use any publish tool");
    expect(guide).toContain("nothing auto-publishes");
  });

  it("prints the take and revision counts", () => {
    expect(renderDirectorGuide(input())).toMatch(/1 take per prompt[\s\S]*At most 1 revision per prompt/);
    expect(renderDirectorGuide(input({ takesPerPrompt: 3, maxRevisions: 2 }))).toMatch(/3 takes per prompt[\s\S]*At most 2 revisions per prompt/);
  });

  it("contains no em dash", () => {
    expect(renderDirectorGuide(input({ perSceneModel: getModel("veo-3-1") }))).not.toContain(EM_DASH);
  });

  it("rejects wrong model kinds and bad counts", () => {
    expect(() => renderDirectorGuide(input({ imageModel: getModel("seedance-2-5") }))).toThrow(/image model/);
    expect(() => renderDirectorGuide(input({ draftModel: getModel("nano-banana-pro") }))).toThrow(/video model/);
    expect(() => renderDirectorGuide(input({ takesPerPrompt: 0 }))).toThrow(/takesPerPrompt/);
    expect(() => renderDirectorGuide(input({ maxRevisions: -1 }))).toThrow(/maxRevisions/);
    expect(() => renderDirectorGuide(input({ checklist: [] }))).toThrow(/checklist/);
  });
});
