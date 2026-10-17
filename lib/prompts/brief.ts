// The four inputs every Production Pack is built from. The Control (LLM-only brief) and the
// culture-made packs go through the same concept writer, templates and settings; only BriefSlots differ.
//   ProductSpec   the product alone (shared, so the product looks identical in every clip)
//   BriefSlots    the segment's cues, each with an origin and its receipts
//   Concept       the Creative Director's chosen concept: hook, surprise beat, 3 to 5 timed scenes
//   PackSettings  format, template version, models and the user's creative direction (shared)
import { z } from "zod";
import { ageBucketSchema, creativeDirectionSchema, cueSchema } from "../types";
import { CAMERA_PRESET_IDS, MODEL_IDS, ROLE_DEFAULTS } from "./models.config";

/** Bump when any template's wording changes: approved hashes then stop matching and need a new review. */
export const TEMPLATE_VERSION = 1;
export const AD_SECONDS = 15;
export const AD_ASPECT = "9:16";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "must be a lowercase slug" });

// ProductSpec ----------------------------------------------------------------------------------

const sourceImageSchema = z.strictObject({
  url: z.url({ protocol: /^https$/, error: "source images must be https URLs" }),
  /** Set by the page reader. A photo that shows a person is never used as a reference. */
  showsPerson: z.boolean(),
  alt: z.string().optional(),
});

export const productSpecSchema = z.strictObject({
  slug,
  /** Generic product name, e.g. "small-batch hot sauce". */
  name: z.string().trim().min(1),
  /** The brand's name, or null while the example still has a working name. Only ever used in overlay text. */
  brandName: z.string().trim().min(1).nullable(),
  oneLine: z.string().trim().min(1),
  source: z.discriminatedUnion("kind", [
    /** Fictional products: a text description of the physical product (packshot is generated). */
    z.strictObject({ kind: z.literal("description"), lookDescription: z.string().trim().min(20) }),
    /** Real brands: their own product photos (from /products.json), product-only shots preferred. */
    z.strictObject({
      kind: z.literal("images"),
      images: z
        .array(sourceImageSchema)
        .min(1)
        .max(14)
        .refine((images) => images.some((image) => !image.showsPerson), {
          error: "needs at least one product-only photo (no person in it)",
        }),
    }),
  ]),
});
export type ProductSpec = z.infer<typeof productSpecSchema>;

// BriefSlots -----------------------------------------------------------------------------------

export const briefSlotsSchema = z.strictObject({
  segment: z.strictObject({
    /** "control" for the LLM-only brief, otherwise the segment id. Used in asset filenames. */
    id: slug,
    label: z.string().trim().min(1),
    ageBands: z.array(ageBucketSchema).min(1),
  }),
  productRole: cueSchema,
  mood: cueSchema,
  /** Genre, era, tempo and instrumentation. Never a song title or an artist name. */
  music: cueSchema,
  /** Grade, lens, grain, framing and pacing, from film and TV affinities. */
  visual: cueSchema,
  wardrobe: cueSchema.nullable(),
  setting: z.array(cueSchema).min(1).max(3),
  voice: z.strictObject({
    tone: cueSchema,
    use: z.array(z.string().trim().min(1)).max(5),
    avoid: z.array(z.string().trim().min(1)).max(5),
  }),
  /** A fictional adult, described by styling and energy. Null for product-only and pet ads. */
  talent: cueSchema.nullable(),
  /** Hook ideas the brief already suggests; the concept writer may use or replace them. */
  hooks: z.array(cueSchema).max(5),
  /** Cities or places a prompt may name: only ones Qloo returned (with receipts). Empty for the Control. */
  allowedPlaces: z.array(z.string().trim().min(1)),
});
export type BriefSlots = z.infer<typeof briefSlotsSchema>;

/** Every brief slot key, as briefCueTexts names them (BRIEF_SLOT in lib/report/world.ts matches each). */
export const BRIEF_SLOTS = ["productRole", "mood", "music", "visual", "voice.tone", "setting.0", "setting.1", "setting.2", "wardrobe", "talent"] as const;
export type BriefSlot = (typeof BRIEF_SLOTS)[number];

/** The cue slots a pack must carry, by key, for the coverage check. */
export function briefCueTexts(brief: BriefSlots): { slot: BriefSlot; text: string }[] {
  const cues: { slot: BriefSlot; text: string }[] = [
    { slot: "productRole", text: brief.productRole.text },
    { slot: "mood", text: brief.mood.text },
    { slot: "music", text: brief.music.text },
    { slot: "visual", text: brief.visual.text },
    { slot: "voice.tone", text: brief.voice.tone.text },
    ...brief.setting.map((cue, index) => ({ slot: `setting.${index}` as BriefSlot, text: cue.text })),
  ];
  if (brief.wardrobe) cues.push({ slot: "wardrobe", text: brief.wardrobe.text });
  if (brief.talent) cues.push({ slot: "talent", text: brief.talent.text });
  return cues;
}

// Concept --------------------------------------------------------------------------------------

export const SCENE_BEATS = ["hook", "product", "cultural", "escalation", "payoff"] as const;

export const sceneSchema = z.strictObject({
  beat: z.enum(SCENE_BEATS),
  seconds: z.number().int().min(1).max(8),
  /** What happens, in one or two sentences. */
  action: z.string().trim().min(1),
  camera: z.enum(CAMERA_PRESET_IDS),
  framing: z.string().trim().min(1),
  /** How the subject moves. */
  motion: z.string().trim().min(1),
  lighting: z.string().trim().min(1),
  productVisible: z.boolean(),
  /** Slug of one of the concept's location plates. */
  location: slug,
  /** Text added in the edit (video models garble text, so prompts ask for none). */
  overlayText: z.string().trim().min(1).nullable(),
  /** A spoken line in the brand's own voice, or null. */
  dialogue: z.string().trim().min(1).nullable(),
  /** Ambient sound and effects for this scene. */
  sound: z.string().trim().min(1),
});
export type Scene = z.infer<typeof sceneSchema>;

export const locationSchema = z.strictObject({
  slug,
  description: z.string().trim().min(1),
  timeOfDay: z.string().trim().min(1),
  lighting: z.string().trim().min(1),
});
export type Location = z.infer<typeof locationSchema>;

export const conceptSchema = z
  .strictObject({
    title: z.string().trim().min(1),
    /** The first second: what we see and the on-screen line. */
    hook: z.string().trim().min(1),
    emotion: z.string().trim().min(1),
    surpriseBeat: z.string().trim().min(1),
    /**
     * What running this concept tests (plan 13.2), e.g. "whether a weekend-dinner moment beats a
     * late-night snack moment for this world". The ad plan's "what to watch" ties to it. Concepts
     * written before Gate 4 have none.
     */
    testHypothesis: z.string().trim().min(1).optional(),
    locations: z.array(locationSchema).min(1).max(2),
    scenes: z.array(sceneSchema).min(3).max(5),
  })
  .superRefine((concept, ctx) => {
    const total = concept.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    if (total !== AD_SECONDS) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `scene lengths add up to ${total} s, not ${AD_SECONDS} s` });
    }
    if (concept.scenes[0]?.beat !== "hook") ctx.addIssue({ code: "custom", path: ["scenes", 0, "beat"], message: "the first scene must be the hook" });
    if (concept.scenes.at(-1)?.beat !== "payoff") {
      ctx.addIssue({ code: "custom", path: ["scenes", concept.scenes.length - 1, "beat"], message: "the last scene must be the payoff" });
    }
    if (!concept.scenes.some((scene) => scene.productVisible)) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "the product must be visible in at least one scene" });
    }
    const slugs = new Set(concept.locations.map((location) => location.slug));
    if (slugs.size !== concept.locations.length) ctx.addIssue({ code: "custom", path: ["locations"], message: "location slugs must be unique" });
    concept.scenes.forEach((scene, index) => {
      if (!slugs.has(scene.location)) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "location"], message: `unknown location "${scene.location}"` });
      }
    });
  });
export type Concept = z.infer<typeof conceptSchema>;

// PackSettings ---------------------------------------------------------------------------------

export const packSettingsSchema = z.strictObject({
  aspect: z.literal(AD_ASPECT),
  seconds: z.literal(AD_SECONDS),
  templateVersion: z.literal(TEMPLATE_VERSION),
  direction: creativeDirectionSchema,
  models: z.strictObject({
    image: z.enum(MODEL_IDS),
    multiShot: z.enum(MODEL_IDS),
    perScene: z.enum(MODEL_IDS).nullable(),
  }),
});
export type PackSettings = z.infer<typeof packSettingsSchema>;

export function defaultPackSettings(direction: z.input<typeof creativeDirectionSchema> = {}): PackSettings {
  return packSettingsSchema.parse({
    aspect: AD_ASPECT,
    seconds: AD_SECONDS,
    templateVersion: TEMPLATE_VERSION,
    direction,
    models: { image: ROLE_DEFAULTS.image, multiShot: ROLE_DEFAULTS.multiShotVideo, perScene: ROLE_DEFAULTS.perSceneVideo },
  });
}
