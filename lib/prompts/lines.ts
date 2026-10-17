// Shared building blocks for the per-model renderers: fixed asset filenames, exclusions written in
// each model's style, and the look and energy lines. Kept in one place so every template words the
// same rule the same way.
import type { Cast, CreativeDirection } from "../types";
import type { BriefSlots, Concept, ProductSpec } from "./brief";
import { ENERGY_PRESETS, LOOK_PRESETS, type ModelConfig } from "./models.config";

const snake = (text: string) => text.replace(/-/g, "_");

/**
 * Fixed asset filenames. The packshot and product sheet belong to the product and are shared by every
 * pack; talent sheets and location plates belong to one segment, so two packs never collide.
 */
export const FILES = {
  packshot: "packshot.png",
  productSheet: "product_sheet.png",
  /** A brand's own product photo, downloaded under a fixed name (keeps its extension). */
  productPhoto: (index: number, url: string) => `product_photo_${index}.${/\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg"}`,
  talentSheet: (segmentId: string) => `talent_${snake(segmentId)}_sheet.png`,
  location: (segmentId: string, slug: string) => `loc_${snake(segmentId)}_${snake(slug)}.png`,
} as const;

/** Photo-real looks use a brand's own photos directly; animated looks redraw the product in style. */
export function usesSourcePhotos(product: ProductSpec, direction: CreativeDirection): boolean {
  return product.source.kind === "images" && (direction.look === "auto" || direction.look === "live_action");
}

/** Up to 3 product-only photos of a brand, in order, under their fixed filenames. */
export function sourcePhotos(product: ProductSpec): { file: string; url: string }[] {
  if (product.source.kind !== "images") return [];
  return product.source.images
    .filter((image) => !image.showsPerson)
    .slice(0, 3)
    .map((image, index) => ({ file: FILES.productPhoto(index + 1, image.url), url: image.url }));
}

/**
 * The files that show the product in every scene: the brand's own photos for photo-real looks,
 * otherwise the product sheet (generated from the packshot, or redrawn from photos in an animated look).
 */
export function productFiles(product: ProductSpec, direction: CreativeDirection): string[] {
  return usesSourcePhotos(product, direction) ? sourcePhotos(product).map((photo) => photo.file) : [FILES.productSheet];
}

/** Who is on screen. "auto" follows the brief: talent if it describes someone, otherwise product only. */
export type ResolvedCast = Exclude<Cast, "auto">;
export function resolveCast(direction: CreativeDirection, brief: BriefSlots): ResolvedCast {
  if (direction.cast !== "auto") return direction.cast;
  return brief.talent ? "adult_talent" : "product_only";
}

/** Talent text for prompts. A user who asks for talent on a brief without one gets a neutral adult. */
export function talentText(brief: BriefSlots): string {
  return brief.talent?.text ?? "an original fictional adult";
}

/** What a scene or clip must never show, in the model's own style. */
export function sceneExclusions(model: ModelConfig): string {
  if (model.exclusionStyle === "inline-no") {
    return "No logos except the product's own. No readable text, captions or watermarks. No real people or celebrity likenesses.";
  }
  return "The product's own label is the only branding; every other surface is plain and unbranded. The frame is free of captions and on-screen text. Everyone shown is an original fictional character.";
}

/** Location plates are empty: no people, no text, no logos, worded for the model. */
export function plateExclusions(model: ModelConfig): string {
  if (model.exclusionStyle === "inline-no") return "No people, no text, no logos.";
  return "Empty of people, text and logos: plain, unbranded surfaces and blank signage.";
}

/** For tools with a separate negative field: unwanted nouns, never "no X" sentences. */
export function negativeNouns(model: ModelConfig, kind: "scene" | "plate"): string | null {
  if (!model.negativeField) return null;
  return kind === "plate"
    ? "people, person, crowd, text, letters, signage text, logos, watermark"
    : "captions, subtitles, text, logos, watermark, celebrity, extra limbs, distorted hands";
}

/** The look line for GLOBAL STYLE. "auto" adds nothing: the brief's visual language decides. */
export function lookLine(direction: CreativeDirection): string | null {
  const style = LOOK_PRESETS[direction.look].globalStyle;
  return style ? style : null;
}

/** For animated looks, film-derived visual language sets palette, grade and pacing only. */
export function visualLine(brief: BriefSlots, direction: CreativeDirection): string {
  return LOOK_PRESETS[direction.look].keepsLensAndGrain
    ? `Visual language: ${brief.visual.text}`
    : `Palette, grade and pacing taken from this visual language: ${brief.visual.text}`;
}

export function energyLine(direction: CreativeDirection): string | null {
  const pacing = ENERGY_PRESETS[direction.energy].pacing;
  return pacing ? pacing : null;
}

/** "0.0s to 3.0s" style timecodes for each scene of a concept. */
export function timecodes(concept: Concept): { start: number; end: number }[] {
  let at = 0;
  return concept.scenes.map((scene) => {
    const span = { start: at, end: at + scene.seconds };
    at = span.end;
    return span;
  });
}

/** Capitalized, with closing punctuation. */
export const sentence = (text: string) => {
  const trimmed = text.trim();
  const capped = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?"]$/.test(capped) ? capped : `${capped}.`;
};

/** Lowercases the first letter of a fragment placed mid-sentence, leaving acronyms ("LED") alone. */
export const fragment = (text: string) => {
  const trimmed = text.trim().replace(/[.!?]$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
};

export const settingText = (brief: BriefSlots) => brief.setting.map((cue) => cue.text).join("; ");

/**
 * Like fragment(), and also lowercases an opening article ("A woman shakes" reads "a woman shakes"),
 * for text placed mid-sentence. Newer templates only: fragment() stays as it is so existing prompts
 * keep their approved hashes.
 */
export const midSentence = (text: string) => fragment(text).replace(/^(?:A|An|The)\s/, (article) => article.toLowerCase());
