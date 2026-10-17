// The storyboard frame template: one still per scene of a world's kept concept, the cheap draft a
// live run renders before any video (lib/media/frames.ts). Built from the world's Production Pack
// (its concept, settings and cast) and its brief, in the image-model template family, so a frame
// carries the same setting, styling, visual language and mood as the scene prompts. Model ids come
// from models.config.ts (FRAME_MODELS); no template names a model.
//
// Sources (read Oct 17, 2026):
//   https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
//     ("[Subject] + [Action] + [Location/context] + [Composition] + [Style]"; with references:
//     "[Reference images] + [Relationship instruction] + [New scenario]"; describe the role of each
//     reference; positive framing)
//   https://fal.ai/models/fal-ai/nano-banana-2/edit/api (image_urls as the references, aspect_ratio 9:16)
//   https://fal.ai/models/fal-ai/flux/schnell/api (text only, portrait_16_9)
//
// A frame prompt is a body (what the frame shows) plus a closing written by code (the reference
// instruction, who may be on screen, the exclusions). The critique's rewrite replaces the body only,
// so a rewritten prompt always keeps the closing's rules.
import { hashOf } from "../hash";
import type { BriefSlots, ProductSpec } from "./brief";
import { fragment, lookLine, midSentence, petNoun, sceneExclusions, sentence, settingText, talentText, visualLine } from "./lines";
import { CAMERA_PRESETS, FRAME_MODELS, getModel, type FrameModel } from "./models.config";
import type { ProductionPack } from "./pack";

/** Bump when the frame wording changes: cached frames then render again under new hashes. */
export const FRAME_TEMPLATE_VERSION = 1;
/** Stills per world: the hook, the payoff and the scenes between, at most this many. */
export const FRAMES_PER_WORLD = 4;
export const FRAME_ASPECT = "9:16";

/**
 * Which scenes get a frame: every scene when the concept has 4 or fewer, otherwise the hook and the
 * payoff plus the scenes between that show the product, then the rest, in scene order.
 */
export function frameScenes(scenes: readonly { productVisible: boolean }[], limit = FRAMES_PER_WORLD): number[] {
  const all = scenes.map((_, index) => index);
  if (all.length <= limit) return all;
  const last = all.length - 1;
  const middle = all.slice(1, last);
  const picked = new Set([0, last, ...middle.filter((i) => scenes[i].productVisible), ...middle]);
  return [...picked].slice(0, limit).sort((a, b) => a - b);
}

/** The product photo a frame references: the first one with no person in it. Never a photo that shows a person. */
export function frameReference(product: ProductSpec): string | null {
  if (product.source.kind !== "images") return null;
  return product.source.images.find((image) => !image.showsPerson)?.url ?? null;
}

export interface FrameInput {
  pack: ProductionPack;
  brief: BriefSlots;
  product: ProductSpec;
  sceneIndex: number;
}

/** What the frame shows: subject and action, location and setting, composition, light and style. */
export function frameBody({ pack, brief, product, sceneIndex }: FrameInput): string {
  const { concept, settings, cast } = pack;
  const scene = concept.scenes[sceneIndex];
  if (!scene) throw new Error(`The concept has no scene ${sceneIndex + 1}.`);
  const model = getModel(settings.models.image);
  const place = concept.locations.find((l) => l.slug === scene.location) ?? concept.locations[0];
  const { direction } = settings;
  const lines = [
    `Storyboard frame for shot ${sceneIndex + 1} of ${concept.scenes.length} (${scene.beat}) of a vertical ${settings.aspect} product ad.`,
    sentence(scene.action),
    sentence(`Caught mid-moment: ${midSentence(scene.motion)}`),
    sentence(`Location: ${fragment(place.description)}, ${fragment(place.timeOfDay)}, ${fragment(place.lighting)}`),
    sentence(`Setting: ${settingText(brief)}`),
  ];
  if (cast === "adult_talent") {
    lines.push(sentence(`The person on screen is an original fictional adult, ${midSentence(talentText(brief))}`));
    if (brief.wardrobe) lines.push(sentence(`Wardrobe: ${brief.wardrobe.text}`));
  } else if (cast === "pet") {
    lines.push(sentence(`${petNoun(direction)} that looks and stands like a real animal`));
    if (brief.wardrobe) lines.push(sentence(`Styling: ${brief.wardrobe.text}`));
  } else if (brief.wardrobe) {
    lines.push(sentence(`Styling around the product: ${brief.wardrobe.text}`));
  }
  if (scene.productVisible) lines.push(`The ${product.name} is clearly visible and is the hero of the frame. ${sentence(`Its role: ${brief.productRole.text}`)}`);
  lines.push(
    sentence(`Composition: ${scene.framing}, ${fragment(CAMERA_PRESETS[scene.camera].phrasing[model.template])}`),
    sentence(`Lighting: ${scene.lighting}`),
    sentence(visualLine(brief, direction)),
    sentence(`Mood: ${brief.mood.text}`),
  );
  const look = lookLine(direction);
  if (look) lines.push(sentence(look));
  return lines.join(" ");
}

/** The rules every frame prompt ends with, rewritten or not: the reference, who may appear, what never does. */
export function frameClosing({ pack, product }: Pick<FrameInput, "pack" | "product">, hasReference: boolean): string {
  const model = getModel(pack.settings.models.image);
  const lines: string[] = [];
  if (hasReference) {
    lines.push(`Use the reference photo as the exact ${product.name}: the same shape, colors, prints and label placement. Take only the product from it and leave its background behind.`);
  } else if (product.source.kind === "description") {
    lines.push(sentence(`The ${product.name} looks like this: ${product.source.lookDescription}`));
  }
  if (pack.cast === "adult_talent") lines.push("Every person in frame is a clearly adult, original fictional character who resembles no real person.");
  else if (pack.cast === "pet") lines.push("The pet is the only living character; no people in frame.");
  else lines.push("No people in frame: the product is the only subject.");
  lines.push("No children, no school settings.", sceneExclusions(model));
  return lines.join(" ");
}

export interface FramePrompt {
  scene: number;
  model: FrameModel;
  prompt: string;
  /** The body alone, which a critique rewrite replaces. */
  body: string;
  referenceUrls: string[];
  /** What the frame is cached and approved by: the template version, endpoint, aspect, prompt and references. */
  promptHash: string;
}

export function framePromptHash(model: FrameModel, prompt: string, referenceUrls: readonly string[]): string {
  return hashOf({ kind: "storyboard-frame", templateVersion: FRAME_TEMPLATE_VERSION, endpoint: model.endpoint, aspect: FRAME_ASPECT, prompt, refs: [...referenceUrls] });
}

/** One frame's prompt: the edit model with the product photo when there is one, the fast text model otherwise. */
export function buildFramePrompt(input: FrameInput, body: string = frameBody(input)): FramePrompt {
  const reference = frameReference(input.product);
  const model = reference ? FRAME_MODELS.edit : FRAME_MODELS.text;
  const referenceUrls = reference ? [reference] : [];
  const prompt = `${body.trim()}\n\n${frameClosing(input, referenceUrls.length > 0)}`;
  return { scene: input.sceneIndex, model, prompt, body: body.trim(), referenceUrls, promptHash: framePromptHash(model, prompt, referenceUrls) };
}
