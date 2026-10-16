// Per-scene video template: one prompt per scene, for models whose clips are shorter than the ad.
// Each scene prompt still carries the segment's whole brief, so no scene drifts off-brief.
// Model ids, durations and reference limits come from models.config.ts; no template names a model.
//
// Sources (read Oct 16, 2026):
//   https://ai.google.dev/gemini-api/docs/veo (subject, action, style, then camera, composition, lens and
//     ambiance; quotes for speech; describe sound effects and ambient sound explicitly; 4, 6 or 8 s, and
//     reference images need 8 s; prompts up to 1,024 tokens)
//   https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/video-gen-prompt-guide
//     (a negative prompt lists unwanted nouns, e.g. "wall, frame", instead of "no walls")
import { CAMERA_PRESETS, type ModelConfig } from "./models.config";
import type { BriefSlots, Concept, Location, PackSettings, ProductSpec } from "./brief";
import { energyLine, FILES, fragment, lookLine, sceneExclusions, sentence, settingText, talentText, visualLine, type ResolvedCast } from "./lines";

export interface SceneInput {
  model: ModelConfig;
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
  cast: ResolvedCast;
  sceneIndex: number;
  /** The one file that shows the product (per-scene models take few references). */
  productRef: string;
}

export function renderScene({ model, product, brief, concept, settings, cast, sceneIndex, productRef }: SceneInput): string {
  const scene = concept.scenes[sceneIndex];
  const place = concept.locations.find((location) => location.slug === scene.location) as Location;
  const { direction } = settings;

  const subject =
    cast === "adult_talent"
      ? `Subject: an original fictional adult as in ${FILES.talentSheet(brief.segment.id)}, ${talentText(brief)}`
      : cast === "pet"
        ? "Subject: a real pet that behaves like a real animal and stays silent"
        : `Subject: the ${product.name} as in ${productRef}, alone in the frame`;

  const lines = [
    sentence(subject),
    sentence(`Action: ${scene.action}`),
    sentence(`Location: ${fragment(place.description)} as in ${FILES.location(brief.segment.id, place.slug)}, ${fragment(place.timeOfDay)}`),
    sentence(`Product: the ${product.name} exactly as in ${productRef}, ${scene.productVisible ? "clearly visible" : "just out of frame"}. Its role: ${brief.productRole.text}`),
    brief.wardrobe ? sentence(`Wardrobe: ${brief.wardrobe.text}`) : null,
    sentence(`Setting: ${settingText(brief)}`),
    lookLine(direction) ? sentence(lookLine(direction) as string) : null,
    sentence(visualLine(brief, direction)),
    sentence(`Mood: ${brief.mood.text}`),
    energyLine(direction) ? sentence(energyLine(direction) as string) : null,
    sentence(`Camera: ${CAMERA_PRESETS[scene.camera].phrasing[model.template]}, ${scene.framing}`),
    sentence(`Motion: ${scene.motion}`),
    sentence(`Lighting: ${scene.lighting}`),
    sentence(`Music: ${brief.music.text}, an original instrumental`),
    sentence(`Sound: ${scene.sound}`),
    sentence(`Voice: ${brief.voice.tone.text}`),
    scene.dialogue ? `${cast === "adult_talent" ? "The character says" : "A voiceover says"}: "${scene.dialogue}"` : null,
    `Vertical ${settings.aspect}.`,
    sceneExclusions(model),
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Token estimate for the model's prompt cap: about 4 characters per token for English, per Google's
 * guidance (https://ai.google.dev/gemini-api/docs/tokens). An estimate, not a tokenizer count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
