// Kling templates: one prompt per scene (shots chained by start frames) and one multi-shot prompt for
// the whole ad. Each shot opens with the shot formula (action, setting, camera move, mood), then
// carries the segment's whole brief so no shot drifts off it. Products and talent are locked with
// Elements built from the pack's sheets; prompts describe them in words, since Elements are attached
// in the app. Model ids, durations and reference limits come from models.config.ts; no template
// names a model.
//
// Sources (read Oct 16, 2026):
//   https://kling.ai/quickstart/klingai-video-3-model-user-guide (no fixed formula: natural language
//     that combines camera movement, action, lighting and timing; Custom Multi-Shot lists "Shot 1, ...
//     Shot 2, ..." with each shot's content and length; 3 to 15 s; Image-to-Video, Start and End
//     Frames and "Start Frame + Element Reference" are supported; Elements from 2 to 4 reference
//     images lock "the traits of characters, items, and the scene"; dialogue is tied to a named
//     character with an optional tone tag, and ambient sound is described in the prompt; native
//     audio; 1080p and 720p; no negative prompt field is described)
//   https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-kling (describe each scene by
//     "action, setting, camera move, mood" as connected narrative beats; use the last frame of one
//     scene as the next scene's start frame "to chain shots seamlessly"; Elements "lock specific
//     characters, products, or objects so their identity stays consistent across all scenes")
// Exclusions are phrased positively (exclusionStyle "positive"), per lines.ts.
import { CAMERA_PRESETS, type ModelConfig } from "./models.config";
import type { BriefSlots, Concept, Location, PackSettings, ProductSpec } from "./brief";
import { energyLine, FILES, fragment, lookLine, midSentence, sceneExclusions, sentence, settingText, talentText, visualLine, type ResolvedCast } from "./lines";

/** Where a chained shot starts, in words for the prompt. Null for a shot that starts from the prompt. */
export type ShotStart = "plate" | "previous" | null;

export interface KlingShotInput {
  model: ModelConfig;
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
  cast: ResolvedCast;
  sceneIndex: number;
  /** The file the product Element is built from (the product sheet, or the brand's first photo). */
  productRef: string;
  start: ShotStart;
}

/** The product, character and wardrobe lines, locked with Elements. */
function elementLines(product: ProductSpec, brief: BriefSlots, cast: ResolvedCast, productRef: string, visible: boolean | null): string[] {
  const shown = visible === null ? "identical shape, colors and label in every shot" : visible ? "clearly visible" : "just out of frame";
  const lines = [sentence(`Product: the ${product.name}, locked as the product Element from ${productRef}, ${shown}. Its role: ${brief.productRole.text}`)];
  if (cast === "adult_talent") {
    lines.push(sentence(`Character: an original fictional adult, locked as the character Element from ${FILES.talentSheet(brief.segment.id)}: ${midSentence(talentText(brief))}`));
  } else if (cast === "pet") {
    lines.push("Character: a real pet that moves like a real animal and stays silent.");
  } else {
    lines.push("The product is the only subject on screen.");
  }
  if (brief.wardrobe) lines.push(sentence(`Wardrobe: ${brief.wardrobe.text}`));
  return lines;
}

function styleLines(brief: BriefSlots, settings: PackSettings): string[] {
  const { direction } = settings;
  return [lookLine(direction) ? sentence(lookLine(direction) as string) : null, sentence(visualLine(brief, direction)), energyLine(direction) ? sentence(energyLine(direction) as string) : null].filter(
    (line): line is string => line !== null,
  );
}

const speaker = (cast: ResolvedCast) => (cast === "adult_talent" ? "[The character]" : "[Voiceover]");

/** One shot: the shot formula first, then the whole brief. */
export function renderKlingShot({ model, product, brief, concept, settings, cast, sceneIndex, productRef, start }: KlingShotInput): string {
  const scene = concept.scenes[sceneIndex];
  const place = concept.locations.find((location) => location.slug === scene.location) as Location;
  const camera = CAMERA_PRESETS[scene.camera].phrasing[model.template];
  const lines = [
    sentence(
      `Shot ${sceneIndex + 1} of ${concept.scenes.length}, ${scene.seconds} seconds: ${midSentence(scene.action)}, in ${midSentence(place.description)}, ${fragment(place.timeOfDay)}, ${camera}; mood: ${brief.mood.text}`,
    ),
    start === "previous"
      ? "It opens on its start frame, the last frame of the previous shot, and the motion carries straight on."
      : start === "plate"
        ? `It opens on its start frame, the empty location as in ${FILES.location(brief.segment.id, place.slug)}, and the action enters it.`
        : null,
    sentence(`Setting: ${settingText(brief)}`),
    ...elementLines(product, brief, cast, productRef, scene.productVisible),
    sentence(`Framing: ${scene.framing}`),
    sentence(`Motion: ${scene.motion}`),
    sentence(`Lighting: ${scene.lighting}`),
    ...styleLines(brief, settings),
    sentence(`Audio: ${brief.music.text}, an original instrumental`),
    sentence(`Sound: ${scene.sound}`),
    sentence(`Voice: ${brief.voice.tone.text}`),
    scene.dialogue ? `${speaker(cast)}: "${scene.dialogue}"` : null,
    `Vertical ${settings.aspect}.`,
    sceneExclusions(model),
  ];
  return lines.filter(Boolean).join("\n");
}

export interface KlingMultiShotInput {
  model: ModelConfig;
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
  cast: ResolvedCast;
  productRef: string;
}

/** The whole ad as custom multi-shot: global lines, then "Shot N (S s)" in order. */
export function renderKlingMultiShot({ model, product, brief, concept, settings, cast, productRef }: KlingMultiShotInput): string {
  const segment = brief.segment.id;
  const places = new Map(concept.locations.map((location) => [location.slug, location]));
  const shots = concept.scenes.map((scene, index) => {
    const place = places.get(scene.location) as Location;
    const camera = CAMERA_PRESETS[scene.camera].phrasing[model.template];
    return [
      `Shot ${index + 1} (${scene.seconds} s, ${scene.beat}): ${sentence(`${midSentence(scene.action)}, in ${midSentence(place.description)}, ${camera}, a feeling of ${fragment(concept.emotion)}`)}`,
      sentence(`Framing: ${scene.framing}`),
      sentence(`Motion: ${scene.motion}`),
      sentence(`Lighting: ${scene.lighting}`),
      sentence(`Sound: ${scene.sound}`),
      scene.dialogue ? `${speaker(cast)}: "${scene.dialogue}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
  const lines = [
    `Multi-shot video, ${concept.scenes.length} custom shots, ${settings.seconds} seconds, vertical ${settings.aspect}. Each shot keeps its own length.`,
    sentence(`${concept.title}: ${midSentence(concept.hook)}`),
    sentence(`Surprise beat: ${concept.surpriseBeat}`),
    ...elementLines(product, brief, cast, productRef, null),
    ...concept.locations.map((place) => sentence(`Location ${FILES.location(segment, place.slug)}: ${midSentence(place.description)}, ${fragment(place.timeOfDay)}, ${fragment(place.lighting)}`)),
    sentence(`Setting: ${settingText(brief)}`),
    ...styleLines(brief, settings),
    sentence(`Mood: ${brief.mood.text}`),
    ...shots,
    sentence(`Audio: ${brief.music.text}, an original instrumental`),
    sentence(`Voice: ${brief.voice.tone.text}`),
    sceneExclusions(model),
  ];
  return lines.join("\n");
}
