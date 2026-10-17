// Runway template: one image-to-video prompt per scene. Runway renders 9:16 only from a start frame
// (text-to-video is 16:9 only) and takes no reference images, so every scene starts from a frame:
// the scene's location plate, or the last frame of the previous scene when the location stays the
// same. The prompt leads with the motion sentence the guide asks for ("The camera [motion] as the
// subject [action]"), then introduces what the start frame lacks (product, character, wardrobe) and
// carries the rest of the segment's brief, because every Stoop render prompt carries the whole brief
// (the coverage and rich-field checks in pack.ts). The guide warns that very long prompts can
// over-constrain the model, so the brief lines stay one short line each. Model ids, durations and
// limits come from models.config.ts; no template names a model.
//
// Sources:
//   https://academy.runwayml.com/guides/prompting-guide (read Oct 16, 2026: text-to-video is
//     "[Camera] shot of [a subject/object] [action] in [environment]"; image-to-video is "The camera
//     [motion description] as the subject [action]. [Additional descriptions]" and should "focus
//     almost exclusively on motion", describing visual elements only when introducing something not
//     in the image; the input image becomes the first frame; timestamps like "[00:01]"; "Describe
//     what you want to see rather than what you don't want"; for longer sequences, use the last
//     frame of a clip as the input image of the next)
//   https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5 and
//     https://help.runwayml.com/hc/en-us/articles/42460036199443 (as recorded in models.config.ts,
//     checked Oct 16, 2026: 2 to 10 s, 720p, 9:16 only through image-to-video, no reference images;
//     both pages refused the automated fetch on Oct 16, 2026, so their facts are not re-read here)
import { CAMERA_PRESETS, type ModelConfig } from "./models.config";
import type { BriefSlots, Concept, Location, PackSettings, ProductSpec } from "./brief";
import { energyLine, fragment, lookLine, midSentence, sceneExclusions, sentence, settingText, talentText, visualLine, type ResolvedCast } from "./lines";
import type { ShotStart } from "./kling";

export interface RunwaySceneInput {
  model: ModelConfig;
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
  cast: ResolvedCast;
  sceneIndex: number;
  /** Runway always starts from a frame: the location plate, or the previous scene's last frame. */
  start: Exclude<ShotStart, null>;
}

/** The product in words, as its own sentence: Runway cannot see the product sheet. */
function productLook(product: ProductSpec): string {
  return product.source.kind === "description" ? ` It looks like this: ${sentence(product.source.lookDescription)}` : "";
}

export function renderRunwayScene({ model, product, brief, concept, settings, cast, sceneIndex, start }: RunwaySceneInput): string {
  const scene = concept.scenes[sceneIndex];
  const place = concept.locations.find((location) => location.slug === scene.location) as Location;
  const { direction } = settings;
  const character =
    cast === "adult_talent"
      ? sentence(`Character: an original fictional adult, ${midSentence(talentText(brief))}`)
      : cast === "pet"
        ? "Character: a real pet that moves like a real animal."
        : "The product is the only subject on screen.";
  const lines = [
    sentence(`${CAMERA_PRESETS[scene.camera].phrasing[model.template]} as ${midSentence(scene.action)}`),
    sentence(`Motion: ${scene.motion}; framing: ${fragment(scene.framing)}`),
    start === "previous"
      ? "The shot carries straight on from its start frame, the last frame of the previous shot."
      : sentence(`The start frame shows ${midSentence(place.description)}, ${fragment(place.timeOfDay)}, empty, and the action enters it`),
    `${sentence(`Product: the ${product.name}, ${scene.productVisible ? "clearly visible" : "just out of frame"}`)}${productLook(product)} ${sentence(`Its role: ${brief.productRole.text}`)}`,
    character,
    brief.wardrobe ? sentence(`Wardrobe: ${brief.wardrobe.text}`) : null,
    sentence(`Setting: ${settingText(brief)}`),
    sentence(`Lighting: ${scene.lighting}`),
    lookLine(direction) ? sentence(lookLine(direction) as string) : null,
    sentence(visualLine(brief, direction)),
    sentence(`Mood: ${brief.mood.text}`),
    energyLine(direction) ? sentence(energyLine(direction) as string) : null,
    ...(model.audio
      ? [
          sentence(`Audio: ${brief.music.text}, an original instrumental`),
          sentence(`Sound: ${scene.sound}`),
          sentence(`Voice: ${brief.voice.tone.text}`),
          scene.dialogue ? `${cast === "adult_talent" ? "The character says" : "A voiceover says"}: "${scene.dialogue}"` : null,
        ]
      : // A silent model: music and voice are added in the edit, and still set the pacing and energy here.
        [sentence(`Pacing follows the music added in the edit: ${brief.music.text}`), sentence(`Energy follows the voice added in the edit: ${brief.voice.tone.text}`)]),
    `Vertical ${settings.aspect}.`,
    sceneExclusions(model),
  ];
  return lines.filter(Boolean).join("\n");
}
