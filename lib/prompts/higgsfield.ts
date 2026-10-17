// Templates for the models Stoop's Production Pack uses on Higgsfield: the multi-shot video template
// (one prompt for the whole 15 s ad) and the image template for asset sheets and location plates.
// Model ids and limits come from models.config.ts; no template names a model.
//
// Sources (read Oct 16, 2026):
//   Multi-shot video: https://higgsfield.ai/blog/seedance-2-5-prompting-guide (section order GLOBAL STYLE,
//     SCENE, CHARACTERS, LOCATION, FIRST FRAME AND BLOCKING, shot by shot, OPTICS/CAMERA, PHYSICS, LIGHTING,
//     AUDIO; timecodes "0.0s to 3.0s" and "Hard cut"; "@" references; a vague location is the main cause
//     of drift between shots, so every shot names its location plate)
//   https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance (references by "@")
//   https://higgsfield.ai/creator-hub/help-center/getting-started/how-do-i-write-a-good-prompt (say what
//     you want; a few short exclusions like "no readable text" help, and there is no negative field)
//   Images: https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
//     ("[Subject] + [Action] + [Location/context] + [Composition] + [Style]"; with references:
//     "[Reference images] + [Relationship instruction] + [New scenario]"; describe the role of each
//     reference; positive framing; "three-point softbox setup")
//   https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-nano-banana (start at 1K when iterating)
import { CAMERA_PRESETS, type ModelConfig } from "./models.config";
import type { BriefSlots, Concept, Location, PackSettings, ProductSpec } from "./brief";
import {
  energyLine,
  FILES,
  fragment,
  lookLine, petNoun,
  plateExclusions,
  sceneExclusions,
  sentence,
  settingText,
  talentText,
  timecodes,
  visualLine,
  type ResolvedCast,
} from "./lines";

export interface MultiShotInput {
  model: ModelConfig;
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
  cast: ResolvedCast;
  /** Files that show the product: the product sheet, or the brand's own photos. */
  productRefs: string[];
}

/** Reference handle in the model's own syntax, followed by the exact filename. */
function ref(model: ModelConfig, file: string): string {
  const name = file.replace(/\.(png|jpe?g|webp)$/, "");
  return model.refSyntax === "@" ? `@${name} (${file})` : file;
}

/** One prompt for the whole ad: timed shots with hard cuts, every scene carrying the full brief. */
export function renderMultiShot({ model, product, brief, concept, settings, cast, productRefs }: MultiShotInput): string {
  const { direction } = settings;
  const segment = brief.segment.id;
  const productRef = productRefs.map((file) => ref(model, file)).join(", ");
  const spans = timecodes(concept);
  const locationsBySlug = new Map(concept.locations.map((location) => [location.slug, location]));

  const globalStyle = [
    `Vertical ${settings.aspect} product ad, ${settings.seconds} seconds, ${concept.scenes.length} shots with hard cuts.`,
    lookLine(direction) && sentence(lookLine(direction) as string),
    sentence(visualLine(brief, direction)),
    sentence(`Mood: ${brief.mood.text}`),
    energyLine(direction) && sentence(energyLine(direction) as string),
    sceneExclusions(model),
  ].filter(Boolean);

  const characters: string[] = [];
  if (cast === "adult_talent") {
    characters.push(
      `${ref(model, FILES.talentSheet(segment))}: ${sentence(`an original fictional adult, ${fragment(talentText(brief))}`)}` +
        (brief.wardrobe ? ` Wardrobe: ${sentence(brief.wardrobe.text)}` : ""),
    );
  } else if (cast === "pet") {
    characters.push(
      sentence(`${petNoun(direction)} that behaves like a real animal and never talks`) + (brief.wardrobe ? ` Styling: ${sentence(brief.wardrobe.text)}` : ""),
    );
  } else {
    characters.push("No people on screen. The product is the only character.");
    if (brief.wardrobe) characters.push(`Styling around the product: ${sentence(brief.wardrobe.text)}`);
  }
  characters.push(
    `${productRef}: the ${product.name}, identical shape, colors and label in every shot. Its role: ${sentence(brief.productRole.text)}`,
  );

  const location = concept.locations.map(
    (place) => `${ref(model, FILES.location(segment, place.slug))}: ${sentence(`${fragment(place.description)}, ${fragment(place.timeOfDay)}, ${fragment(place.lighting)}`)}`,
  );
  location.push(sentence(`Setting: ${settingText(brief)}`));

  const first = concept.scenes[0];
  const shots = concept.scenes.map((scene, index) => {
    const { start, end } = spans[index];
    const place = locationsBySlug.get(scene.location) as Location;
    return [
      `${start.toFixed(1)}s to ${end.toFixed(1)}s (${scene.beat}):`,
      sentence(scene.action),
      sentence(`${scene.framing}, at ${ref(model, FILES.location(segment, place.slug))}`),
      sentence(`Camera: ${CAMERA_PRESETS[scene.camera].phrasing[model.template]}`),
      sentence(scene.motion),
      scene.productVisible ? `${ref(model, productRefs[0])} is clearly visible.` : "",
      index < concept.scenes.length - 1 ? "Hard cut." : "",
    ]
      .filter(Boolean)
      .join(" ");
  });

  const voicedBy = cast === "adult_talent" ? "the character says" : "a voiceover says";
  const dialogue = concept.scenes
    .map((scene, index) => (scene.dialogue ? `Shot ${index + 1}, ${voicedBy}: "${scene.dialogue}"` : null))
    .filter((line): line is string => line !== null);

  const sections: [string, string[]][] = [
    ["GLOBAL STYLE", globalStyle as string[]],
    ["SCENE", [sentence(concept.title), sentence(concept.hook), sentence(`The feeling is ${concept.emotion}`), sentence(`Surprise beat: ${concept.surpriseBeat}`)]],
    ["CHARACTERS", characters],
    ["LOCATION", location],
    ["FIRST FRAME AND BLOCKING", [sentence(first.framing), sentence(first.action)]],
    ["SHOTS", shots],
    [
      "OPTICS/CAMERA",
      [
        "Camera moves exactly as listed per shot; framing stays tight enough for reactions to read.",
        direction.look === "auto" || direction.look === "live_action"
          ? "Lens, grain and grade follow the visual language in GLOBAL STYLE."
          : "Stylized camera to match the look; grade and texture follow the visual language in GLOBAL STYLE.",
      ],
    ],
    [
      "PHYSICS",
      [
        "Real-world weight and motion. The product never warps, melts or changes between shots.",
        cast === "pet" ? "Animals move like real animals." : "",
      ].filter(Boolean),
    ],
    ["LIGHTING", concept.scenes.map((scene, index) => `Shot ${index + 1}: ${sentence(scene.lighting)}`)],
    [
      "AUDIO",
      [
        sentence(`Music: ${brief.music.text}, an original instrumental with no lyrics and no real songs`),
        sentence(`Voice: ${brief.voice.tone.text}`),
        ...dialogue,
        `Sound: ${concept.scenes.map((scene, index) => `shot ${index + 1}, ${scene.sound}`).join("; ")}.`,
      ],
    ],
  ];

  return sections.map(([title, lines]) => `${title}\n${lines.join("\n")}`).join("\n\n");
}

// Image assets ---------------------------------------------------------------------------------

export interface ImagePrompt {
  prompt: string;
  /** Filenames or source-image URLs, in the order the prompt describes them. */
  refs: string[];
}

/** A clean, photoreal packshot from the text description (fictional products only). */
export function renderPackshot(model: ModelConfig, product: ProductSpec): ImagePrompt {
  if (product.source.kind !== "description") throw new Error("Packshots are only generated for products described in text.");
  const clean = model.exclusionStyle === "inline-no" ? " No readable text, no other logos, no props, no people." : " Plain, unbranded surroundings, free of text, props and people.";
  return {
    prompt:
      `A product photograph of the ${product.name}: ${sentence(product.source.lookDescription)}` +
      " The product stands alone, centered on a seamless white background, lit by a soft three-point softbox setup, with true-to-life color and sharp focus." +
      " The label carries a simple symbol only, with the brand name left off so it can be added in the edit." +
      clean,
    refs: [],
  };
}

/** Front, back, side and three-quarter views, so every shot keeps the exact product. */
export function renderProductSheet(model: ModelConfig, product: ProductSpec, settings: PackSettings): ImagePrompt {
  const style = lookLine(settings.direction);
  const layout =
    "Product model sheet: front, back, left side and three-quarter views in one row on a clean white background, with even studio lighting.";
  if (product.source.kind === "images") {
    // Product-only photos as references; a photo that shows a person is never passed on.
    const refs = product.source.images.filter((image) => !image.showsPerson).map((image) => image.url);
    return {
      prompt:
        `Redraw this exact ${product.name} from the reference photos: the same shape, colors, prints and logo placement. ` +
        "Use only the product itself and leave every background behind. " +
        layout +
        (style ? ` Render it in this style: ${sentence(style)} The design stays exactly the same.` : " Photoreal."),
      refs,
    };
  }
  return {
    prompt:
      `Using ${FILES.packshot} as the exact reference for the ${product.name}, create a ${layout.charAt(0).toLowerCase()}${layout.slice(1)} ` +
      "The shape, materials, colors and label symbol are identical in every view." +
      (style ? ` Render it in this style: ${sentence(style)} The design stays exactly the same.` : " Photoreal."),
    refs: [FILES.packshot],
  };
}

/** A fictional adult, styled from the brief. Skipped for product-only and pet ads. */
export function renderTalentSheet(model: ModelConfig, brief: BriefSlots, settings: PackSettings): ImagePrompt {
  const style = lookLine(settings.direction);
  return {
    prompt:
      `A character sheet of an original fictional adult: ${sentence(talentText(brief))}` +
      (brief.wardrobe ? ` Wardrobe: ${sentence(brief.wardrobe.text)}` : "") +
      " Front view, side profile and full body, side by side on a clean light gray studio background, with a relaxed expression and the same face, hair and outfit in all three views. Even, soft lighting." +
      (style ? ` ${sentence(style)}` : " Photoreal.") +
      (model.exclusionStyle === "inline-no"
        ? " An original character: no resemblance to any real person or celebrity, no logos."
        : " An original character created for this ad, wearing plain, unbranded clothing."),
    refs: [],
  };
}

/** An empty location plate for one concept location, carrying the brief's setting. */
export function renderLocationPlate(model: ModelConfig, brief: BriefSlots, place: Location, settings: PackSettings): ImagePrompt {
  const style = lookLine(settings.direction);
  return {
    prompt:
      `A location plate of ${fragment(place.description)}, ${fragment(place.timeOfDay)}, ${fragment(place.lighting)}. ` +
      sentence(`Setting: ${settingText(brief)}`) +
      ` Vertical ${settings.aspect} frame at eye level, wide enough to stage the product and any action. ` +
      sentence(visualLine(brief, settings.direction)) +
      (style ? ` ${sentence(style)}` : "") +
      ` ${plateExclusions(model)}`,
    refs: [],
  };
}
