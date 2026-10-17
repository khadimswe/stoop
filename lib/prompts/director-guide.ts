// The Director's Guide that ships with every Production Pack: the order to render in, the cheapest
// settings to draft with, the checklist to judge takes by, and the rules that keep the Control and the
// culture-made clips comparable. Model names come only from the ModelConfig objects passed in, so the
// guide always matches the models the pack was written for.
import type { ChecklistItem } from "./critique-checklist";
import { AI_DISCLOSURE_NOTE, HUMAN_REVIEW_CHECKLIST } from "./critique-checklist";
import type { ModelConfig } from "./models.config";

export interface DirectorGuideInput {
  imageModel: ModelConfig;
  /** Renders the cheap drafts of the main clip. */
  draftModel: ModelConfig;
  /** Renders the approved prompts as finals. */
  finalModel: ModelConfig;
  /** Optional model for tools that render scene by scene. */
  perSceneModel?: ModelConfig;
  /** Other per-scene models the pack also writes prompts for (copy-ready for other tools). */
  extraSceneModels?: readonly ModelConfig[];
  /** Per-scene models the pack skipped because they cannot show this product (no reference images, no text look). */
  skippedSceneModels?: readonly ModelConfig[];
  checklist: readonly ChecklistItem[];
  takesPerPrompt: number;
  maxRevisions: number;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const checkbox = (text: string) => `- [ ] ${text}`;

function assertKind(model: ModelConfig, kind: ModelConfig["kind"], role: string): void {
  if (model.kind !== kind) throw new Error(`Director's Guide: ${role} must be a ${kind} model, got ${model.displayName}`);
}

export function renderDirectorGuide(input: DirectorGuideInput): string {
  const { imageModel, draftModel, finalModel, perSceneModel, checklist, takesPerPrompt, maxRevisions } = input;
  const extras = input.extraSceneModels ?? [];
  assertKind(imageModel, "image", "imageModel");
  assertKind(draftModel, "video", "draftModel");
  assertKind(finalModel, "video", "finalModel");
  if (perSceneModel) assertKind(perSceneModel, "video", "perSceneModel");
  for (const model of extras) assertKind(model, "video", "extraSceneModels");
  if (!Number.isInteger(takesPerPrompt) || takesPerPrompt < 1) throw new Error("Director's Guide: takesPerPrompt must be a whole number of 1 or more");
  if (!Number.isInteger(maxRevisions) || maxRevisions < 0) throw new Error("Director's Guide: maxRevisions must be a whole number of 0 or more");
  if (checklist.length === 0) throw new Error("Director's Guide: the checklist must not be empty");

  const takes = plural(takesPerPrompt, "take", "takes");
  const revisions = plural(maxRevisions, "revision", "revisions");

  const lines: string[] = [
    "# Director's Guide",
    "",
    "Render in this order: assets, cheap drafts, check, revise, then finals. Start at the lowest setting and spend more only on prompts that pass.",
    "",
    "## 1. Assets first",
    "",
    `- Render each asset prompt on ${imageModel.displayName} at ${imageModel.draftSetting}.`,
    "- Check that the product looks the same in every asset: colors, prints and logo placement.",
    `- Re-render the approved asset prompts on ${imageModel.displayName} at ${imageModel.finalSetting}.`,
    "- Save each asset under its exact filename (for example `product_sheet.png`). Scene prompts reference assets by filename, so a renamed file breaks them.",
    "",
    "## 2. Draft",
    "",
    `- Render each scene prompt on ${draftModel.displayName} at ${draftModel.draftSetting}.`,
    `- ${takes} per prompt.`,
  ];
  if (perSceneModel) {
    lines.push(`- For scene-by-scene clips, use ${perSceneModel.displayName} at ${perSceneModel.draftSetting}.`);
  }
  for (const model of extras) lines.push(`- The pack also has scene prompts for ${model.displayName}: draft them at ${model.draftSetting}.`);
  for (const model of input.skippedSceneModels ?? []) {
    lines.push(`- No scene prompts for ${model.displayName}: it takes no reference images, and this product is shown only by the brand's photos, so it would invent the product.`);
  }
  if (perSceneModel || extras.length > 0) {
    lines.push(
      "- Some scene prompts start from a frame (listed with the prompt). Render those scenes in order: a scene that starts from the last frame of an earlier scene waits for that take, and one that starts from a location plate uses the plate as its first frame.",
      "- When a clip renders longer than its scene, cut it to the scene's length from its start, and take the next scene's start frame from the last frame you keep (at the cut), not from the end of the raw clip.",
      "- Where a tool locks the product or a character with Elements, build them from the files the prompt names (the product sheet or the brand's photos, the talent sheet).",
    );
  }
  lines.push(
    "",
    "## 3. Check",
    "",
    "Check every take against this list. An item marked (blocking) fails the take.",
    "",
    ...checklist.map((item) => checkbox(item.blocking ? `${item.text} (blocking)` : item.text)),
    "",
    "## 4. Revise",
    "",
    "- When a take fails, fix the prompt, not the take.",
    maxRevisions === 0
      ? "- 0 revisions: if a take fails, log it and keep the best take that passes."
      : `- At most ${revisions} per prompt, then keep the best take that passes.`,
    "- Log what changed in each revision and why.",
    "",
    "## 5. Final",
    "",
    `- Render the approved prompts on ${finalModel.displayName} at ${finalModel.finalSetting}, in batches.`,
    "- Use the same prompt and seed as the approved draft (where the tool shows a seed).",
  );
  if (perSceneModel) {
    lines.push(`- Scene-by-scene finals go on ${perSceneModel.displayName} at ${perSceneModel.finalSetting}.`);
  }
  for (const model of extras) lines.push(`- ${model.displayName} scene finals: ${model.finalSetting}.`);
  lines.push(
    "",
    "## 6. Edit",
    "",
    "- Stitch the best takes together in an editor if needed.",
    "- Add the brand name, hook line and CTA as overlay text in the edit. The prompts ask for no readable text, so all on-screen words are added here.",
    "- If a label came out garbled, place the real label artwork over it in the edit rather than re-rolling a good take.",
    "- Keep the model's own music in both the Control and the culture-made clips: the music comes from the brief, so it is part of what is being compared.",
    "- If a platform needs a licensed track instead, pick it for both clips by one written rule (genre and tempo from the pack's music note, the first match in one library) and log the track in the manifest.",
    "",
    "## Fairness",
    "",
    "- The Control and the culture-made clips get the same model, settings, number of takes and revisions. Only the brief differs.",
    "- Pick takes by the checklist only.",
    "- Log every take in the manifest, including the ones you did not use.",
    "",
    "## Rules",
    "",
    "- Follow the video tool's terms. Higgsfield's include: get consent from anyone depicted, no impersonation, and AI disclosure where required.",
    "- Never strip provenance marks or watermarks. Output may be watermarked.",
    "- Never use any publish tool from a video app or MCP: nothing auto-publishes.",
    "",
    "## Before you post",
    "",
    ...HUMAN_REVIEW_CHECKLIST.map(checkbox),
    "",
    AI_DISCLOSURE_NOTE,
    "",
  );
  return lines.join("\n");
}
