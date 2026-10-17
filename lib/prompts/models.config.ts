// Image and video model facts for the Production Pack. Model names live only in this file: templates,
// the Director's Guide and the UI read ids, display names and settings from here and never hardcode one.
// Every row was verified against vendor docs on Oct 16, 2026. Where sources disagree, the row uses the
// safer value and the disagreement is recorded in its notes.
//
// Sources (checked Oct 16, 2026):
//   Higgsfield
//     https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-nano-banana
//     https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-seedance
//     https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-kling
//     https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character
//     https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-soul-cinema
//     https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio
//     https://higgsfield.ai/blog/cinema-studio-4-0
//     https://higgsfield.ai/veo3.1
//     https://higgsfield.ai/creator-hub/changelog
//     https://higgsfield.ai/blog/seedance-2-5-prompting-guide
//     https://higgsfield.ai/creator-hub/help-center/getting-started/how-do-i-write-a-good-prompt
//     https://higgsfield.ai/camera-controls
//   Kling
//     https://kling.ai/quickstart/klingai-video-3-model-user-guide
//   Google
//     https://ai.google.dev/gemini-api/docs/veo
//     https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/video-gen-prompt-guide
//     https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
//   Runway
//     https://help.runwayml.com/hc/en-us/articles/42460036199443
//     https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5
//     https://academy.runwayml.com/guides/prompting-guide
//
//   fal (storyboard frames, FRAME_MODELS below; checked Oct 17, 2026, FRAME_MODELS_VERIFIED_AT)
//     https://fal.ai/models/fal-ai/nano-banana-2/edit/api
//     https://fal.ai/models/fal-ai/nano-banana-2/edit
//     https://fal.ai/models/fal-ai/flux/schnell/api
//     https://fal.ai/models/fal-ai/flux/schnell
//
// Not listed on purpose: Sora 2 has left Higgsfield's lineup. Kling 4.0 went live Oct 15, 2026 but is
// not confirmed on Higgsfield yet, so it gets no row until it is.
//
// Ids are Stoop's own and stay stable. Higgsfield's web-app slugs are undocumented and inconsistent,
// so `hfSlug` is data only (null when unknown) and nothing builds URLs from it.
import { z } from "zod";
import type { Energy, Look } from "../types";

export const TEMPLATE_FAMILIES = ["seedance", "veo", "kling", "runway", "nano-banana"] as const;
export type TemplateFamily = (typeof TEMPLATE_FAMILIES)[number];

export const MODEL_IDS = [
  "nano-banana-pro",
  "soul-2",
  "seedance-2-5",
  "cinema-studio-4",
  "kling-3",
  "kling-3-turbo",
  "veo-3-1",
  "veo-3-1-fast",
  "runway-gen-4-5",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const VERIFIED_AT = "2026-10-16";

const seconds = z.number().positive({ error: "durations are positive seconds" });

const durationsSchema = z
  .strictObject({
    min: seconds,
    max: seconds,
    /** Exact lengths the model accepts, ascending. Omitted when any length in min..max works. */
    allowed: z.array(seconds).min(1, { error: "allowed must list at least one duration" }).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.min > d.max) ctx.addIssue({ code: "custom", path: ["min"], message: "min must not exceed max" });
    if (!d.allowed) return;
    for (const [index, value] of d.allowed.entries()) {
      if (value < d.min || value > d.max) {
        ctx.addIssue({ code: "custom", path: ["allowed", index], message: `${value} s is outside ${d.min} to ${d.max} s` });
      }
      const previous = d.allowed[index - 1];
      if (previous !== undefined && value <= previous) {
        ctx.addIssue({ code: "custom", path: ["allowed", index], message: "allowed must be strictly ascending" });
      }
    }
  });

export const modelConfigSchema = z
  .strictObject({
    id: z.enum(MODEL_IDS, { error: "unknown model id" }),
    displayName: z.string().trim().min(1, { error: "displayName is required" }),
    vendor: z.string().trim().min(1, { error: "vendor is required" }),
    kind: z.enum(["image", "video"], { error: "kind must be image or video" }),
    template: z.enum(TEMPLATE_FAMILIES, { error: "unknown template family" }),
    /** Higgsfield web-app slug, data only. Null when unknown. */
    hfSlug: z.string().min(1).nullable(),
    supportsImageRefs: z.boolean(),
    /** Image references Stoop may attach. 0 when the model takes none. */
    maxRefs: z.int().nonnegative({ error: "maxRefs must be 0 or more" }),
    supportsStartFrame: z.boolean(),
    supportsEndFrame: z.boolean(),
    /** How a prompt points at a reference: "@" mentions, "Image N", or plain description ("none"). */
    refSyntax: z.enum(["@", "Image N", "none"], { error: "refSyntax must be @, Image N or none" }),
    /** Empty when the vendor does not publish the options. */
    aspectRatios: z.array(z.string().min(1)),
    /** Seconds. Null for image models. */
    durations: durationsSchema.nullable(),
    /** Some models only accept reference images at one length (Veo 3.1: 8 s). */
    refsRequireDuration: seconds.nullable(),
    /** Empty when the vendor does not publish the options. */
    resolutions: z.array(z.string().min(1)),
    /** Human-readable setting for cheap drafts, shown in the Director's Guide. */
    draftSetting: z.string().trim().min(1, { error: "draftSetting is required" }),
    /** Human-readable setting for finals, shown in the Director's Guide. */
    finalSetting: z.string().trim().min(1, { error: "finalSetting is required" }),
    audio: z.boolean(),
    multiShot: z.boolean(),
    /** "inline-no": exclusions go in the prompt as "No logos, no readable text". "positive": describe what you want instead. */
    exclusionStyle: z.enum(["inline-no", "positive"], { error: "exclusionStyle must be inline-no or positive" }),
    /** True when the tool has a separate negative prompt field, which takes a plain noun list ("text, logos"). */
    negativeField: z.boolean(),
    maxPromptTokens: z.int().positive().nullable(),
    notes: z.array(z.string().min(1)),
    verifiedAt: z.literal(VERIFIED_AT, { error: `verifiedAt must be ${VERIFIED_AT}` }),
    sourceUrls: z
      .array(z.url({ protocol: /^https$/, error: "source URLs must be https" }))
      .min(1, { error: "at least one source URL is required" }),
  })
  .superRefine((m, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (m.kind === "image" && m.durations !== null) issue("durations", "image models have no durations");
    if (m.kind === "video" && m.durations === null) issue("durations", "video models need durations");
    if ((m.template === "nano-banana") !== (m.kind === "image")) issue("template", "only image models use the nano-banana template");
    if (m.supportsImageRefs && m.maxRefs < 1) issue("maxRefs", "a model that takes references needs maxRefs of 1 or more");
    if (!m.supportsImageRefs && m.maxRefs !== 0) issue("maxRefs", "maxRefs must be 0 when the model takes no references");
    if (!m.supportsImageRefs && m.refSyntax !== "none") issue("refSyntax", "refSyntax must be none when the model takes no references");
    if (m.refsRequireDuration !== null) {
      if (!m.supportsImageRefs) issue("refsRequireDuration", "refsRequireDuration needs a model that takes references");
      const d = m.durations;
      const fits = d !== null && (d.allowed ? d.allowed.includes(m.refsRequireDuration) : m.refsRequireDuration >= d.min && m.refsRequireDuration <= d.max);
      if (!fits) issue("refsRequireDuration", "refsRequireDuration must be a duration the model accepts");
    }
  });
export type ModelConfig = z.infer<typeof modelConfigSchema>;
type ModelConfigInput = z.input<typeof modelConfigSchema>;

const HF = "https://higgsfield.ai/creator-hub/help-center";
const HF_PROMPTING = `${HF}/getting-started/how-do-i-write-a-good-prompt`;
const HF_CHANGELOG = "https://higgsfield.ai/creator-hub/changelog";

const ROWS = {
  "nano-banana-pro": {
    id: "nano-banana-pro",
    displayName: "Nano Banana Pro",
    vendor: "Google",
    kind: "image",
    template: "nano-banana",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 14,
    supportsStartFrame: false,
    supportsEndFrame: false,
    refSyntax: "none",
    aspectRatios: ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    durations: null,
    refsRequireDuration: null,
    resolutions: ["1K", "2K", "4K"],
    draftSetting: "1K",
    finalSetting: "2K or 4K",
    audio: false,
    multiShot: false,
    exclusionStyle: "positive",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "No reference syntax: describe the role of each reference image in words.",
      "Prompt structure (Google): subject, action, location or context, composition, style.",
      "With references: the reference images, then how they relate, then the new scenario.",
      "Text that must appear on the image goes in quotes.",
      "Higgsfield: start at 1K while iterating, then render the approved prompt at 2K or 4K.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [
      `${HF}/ai-models/how-do-i-use-nano-banana`,
      "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana",
    ],
  },
  "soul-2": {
    id: "soul-2",
    displayName: "Higgsfield Soul 2.0 (Soul Cinema)",
    vendor: "Higgsfield",
    kind: "image",
    // Soul has no published prompting guide, so it shares the still-image template.
    template: "nano-banana",
    hfSlug: null,
    // The app accepts a reference, but attaching one disables the prompt field, so Stoop treats Soul as prompt-only.
    supportsImageRefs: false,
    maxRefs: 0,
    supportsStartFrame: false,
    supportsEndFrame: false,
    refSyntax: "none",
    aspectRatios: [],
    durations: null,
    refsRequireDuration: null,
    resolutions: [],
    draftSetting: "lowest quality the app offers, 1 image per prompt",
    finalSetting: "highest quality the app offers",
    audio: false,
    multiShot: false,
    exclusionStyle: "positive",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "Used for character consistency on talent sheets.",
      "Soul ID needs 20 or more photos of a real person. Stoop never uses Soul ID: talent sheets come from prompts alone and show fictional adults.",
      "Attaching a reference image disables the prompt field.",
      "Aspect ratios, resolutions and quality tiers are not published in the help center (unverified): check the app before rendering.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [`${HF}/ai-models/how-do-i-use-soul-cinema`, `${HF}/ai-models/how-do-i-create-and-use-a-soul-id-character`],
  },
  "seedance-2-5": {
    id: "seedance-2-5",
    displayName: "Seedance 2.5",
    vendor: "ByteDance (on Higgsfield)",
    kind: "video",
    template: "seedance",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 30,
    supportsStartFrame: true,
    supportsEndFrame: false,
    refSyntax: "@",
    aspectRatios: ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9", "Auto"],
    durations: { min: 4, max: 30 },
    refsRequireDuration: null,
    resolutions: ["480p", "720p", "1080p"],
    draftSetting: "480p in Draft Mode",
    finalSetting: "1080p, re-rendered from the approved draft",
    audio: true,
    multiShot: true,
    exclusionStyle: "inline-no",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "Draft Mode is a mode of Seedance 2.5, not a separate model.",
      "1080p needs a Pro or Plus plan.",
      "References use @ mentions. Higgsfield's help center allows 30 images, 10 videos and 10 audio files; the prompting guide says 50 images. Sources disagree, so Stoop uses the lower count (30 images).",
      "Multi-shot clips are written as timed shots in one prompt.",
      "No documented negative prompt field on Higgsfield, so exclusions go inline: \"No logos, no readable text\".",
      "Higgsfield documents 9:16 to 21:9 plus Auto; the ratios in between follow the Seedance family, check the app.",
      "End frames are not documented on Higgsfield: keep continuity with @ references instead.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [`${HF}/ai-models/how-do-i-use-seedance`, "https://higgsfield.ai/blog/seedance-2-5-prompting-guide", HF_PROMPTING, HF_CHANGELOG],
  },
  "cinema-studio-4": {
    id: "cinema-studio-4",
    displayName: "Higgsfield Cinema Studio 4.0",
    vendor: "Higgsfield",
    kind: "video",
    template: "seedance",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 50,
    supportsStartFrame: true,
    supportsEndFrame: false,
    refSyntax: "@",
    aspectRatios: ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"],
    durations: { min: 4, max: 30 },
    refsRequireDuration: null,
    resolutions: ["1080p"],
    draftSetting: "lowest resolution the app offers (or draft on Seedance 2.5 Draft Mode, which shares the template)",
    finalSetting: "1080p",
    audio: true,
    multiShot: true,
    exclusionStyle: "inline-no",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "Runs on Seedance 2.5 and shares its template.",
      "Has its own set of 30 or more camera presets; Stoop's Seedance camera phrasing uses Higgsfield preset names where they exist.",
      "Up to 30 s and up to 1080p. The minimum length, lower resolutions and aspect ratios are assumed from Seedance 2.5 (unverified).",
      "Up to 50 references.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [`${HF}/tools/how-do-i-use-cinema-studio`, "https://higgsfield.ai/blog/cinema-studio-4-0", "https://higgsfield.ai/camera-controls"],
  },
  "kling-3": {
    id: "kling-3",
    displayName: "Kling 3.0",
    vendor: "Kuaishou",
    kind: "video",
    template: "kling",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 4,
    supportsStartFrame: true,
    supportsEndFrame: true,
    refSyntax: "none",
    aspectRatios: ["9:16", "1:1", "16:9"],
    durations: { min: 3, max: 15 },
    refsRequireDuration: null,
    resolutions: ["720p", "1080p", "4K"],
    draftSetting: "720p (or draft on Kling 3.0 Turbo)",
    finalSetting: "1080p (4K where Higgsfield offers it)",
    audio: true,
    multiShot: true,
    exclusionStyle: "positive",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "Elements built from 2 to 4 images lock a product's look; maxRefs counts one Element.",
      "Elements are attached in the UI, so prompts describe the product in words.",
      "Start and end frames supported, and a start frame combines with Element references. Multi-Shot is a switch in the UI; Custom Multi-Shot sets each shot's content and length.",
      "Dialogue is tied to a named speaker with an optional tone tag; ambient sound is described in the prompt.",
      "Resolution sources disagree: Higgsfield lists Kling 3.0 at 4K, Kling's own guide lists 1080p and 720p.",
      "The per-shot structure (action, setting, camera move, mood) and chaining the final frame of each scene into the start frame of the next come from Higgsfield's Kling page, not Kling's own guide.",
      "Kling 4.0 went live Oct 15, 2026 and is not confirmed on Higgsfield yet.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: ["https://kling.ai/quickstart/klingai-video-3-model-user-guide", `${HF}/ai-models/how-do-i-use-kling`],
  },
  "kling-3-turbo": {
    id: "kling-3-turbo",
    displayName: "Kling 3.0 Turbo",
    vendor: "Kuaishou",
    kind: "video",
    template: "kling",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 4,
    supportsStartFrame: true,
    supportsEndFrame: true,
    refSyntax: "none",
    aspectRatios: ["9:16", "1:1", "16:9"],
    durations: { min: 3, max: 15 },
    refsRequireDuration: null,
    resolutions: ["720p", "1080p"],
    draftSetting: "720p",
    finalSetting: "1080p (finals go on Kling 3.0)",
    audio: true,
    multiShot: true,
    exclusionStyle: "positive",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "The cheaper tier for drafts; render finals on Kling 3.0 with the same prompt.",
      "Higgsfield lists Turbo at 1080p; Kling's own guide lists 1080p and 720p.",
      "Same Elements, start and end frames and Multi-Shot switch as Kling 3.0.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: ["https://kling.ai/quickstart/klingai-video-3-model-user-guide", `${HF}/ai-models/how-do-i-use-kling`],
  },
  "veo-3-1": {
    id: "veo-3-1",
    displayName: "Veo 3.1",
    vendor: "Google",
    kind: "video",
    template: "veo",
    hfSlug: null,
    supportsImageRefs: true,
    maxRefs: 3,
    supportsStartFrame: true,
    supportsEndFrame: true,
    refSyntax: "none",
    aspectRatios: ["16:9", "9:16"],
    durations: { min: 4, max: 8, allowed: [4, 6, 8] },
    refsRequireDuration: 8,
    resolutions: ["720p", "1080p", "4K"],
    draftSetting: "720p (or draft on Veo 3.1 Fast)",
    finalSetting: "1080p at 8 s",
    audio: true,
    multiShot: false,
    exclusionStyle: "positive",
    negativeField: true,
    maxPromptTokens: 1024,
    notes: [
      "Durations are exactly 4, 6 or 8 s. Reference images (up to 3) and 1080p or 4K need 8 s.",
      "Reference images work on Standard only, not Fast.",
      "Start frame and end frame (lastFrame in the API).",
      "Prompt structure: subject, action, style, then camera, composition, lens and ambiance.",
      "Speech goes in quotes. Describe sound effects and ambient sound explicitly.",
      "Phrase exclusions positively in the prompt. Where the tool has a negative field, list unwanted nouns (\"text, logos\"), not \"no text\".",
      "Prompts are capped at 1,024 tokens.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [
      "https://ai.google.dev/gemini-api/docs/veo",
      "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/video-gen-prompt-guide",
      "https://higgsfield.ai/veo3.1",
    ],
  },
  "veo-3-1-fast": {
    id: "veo-3-1-fast",
    displayName: "Veo 3.1 Fast",
    vendor: "Google",
    kind: "video",
    template: "veo",
    hfSlug: null,
    supportsImageRefs: false,
    maxRefs: 0,
    supportsStartFrame: true,
    supportsEndFrame: true,
    refSyntax: "none",
    aspectRatios: ["16:9", "9:16"],
    durations: { min: 4, max: 8, allowed: [4, 6, 8] },
    refsRequireDuration: null,
    resolutions: ["720p", "1080p", "4K"],
    draftSetting: "720p",
    finalSetting: "1080p at 8 s (finals go on Veo 3.1)",
    audio: true,
    multiShot: false,
    exclusionStyle: "positive",
    negativeField: true,
    maxPromptTokens: 1024,
    notes: [
      "The cheaper tier for drafts; render finals on Veo 3.1 with the same prompt.",
      "No reference images (Standard only). Start and end frames are available on Higgsfield.",
      "Durations are exactly 4, 6 or 8 s; 1080p and 4K need 8 s.",
      "Same prompt structure and exclusion rules as Veo 3.1.",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: ["https://ai.google.dev/gemini-api/docs/veo", "https://higgsfield.ai/veo3.1"],
  },
  "runway-gen-4-5": {
    id: "runway-gen-4-5",
    displayName: "Runway Gen-4.5",
    vendor: "Runway",
    kind: "video",
    template: "runway",
    hfSlug: null,
    supportsImageRefs: false,
    maxRefs: 0,
    supportsStartFrame: true,
    supportsEndFrame: false,
    refSyntax: "none",
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    durations: { min: 2, max: 10 },
    refsRequireDuration: null,
    resolutions: ["720p"],
    draftSetting: "720p (the only resolution; keep drafts to the shortest length that fits the scene)",
    finalSetting: "720p",
    audio: false,
    multiShot: false,
    exclusionStyle: "positive",
    negativeField: false,
    maxPromptTokens: null,
    notes: [
      "Text-to-video is 16:9 only. Image-to-video supports 16:9, 9:16, 1:1, 4:3, 3:4 and 21:9, so a 9:16 clip needs a start frame.",
      "No reference images yet.",
      "Describe what you want to see; phrase exclusions positively.",
      "Text-to-video structure: \"[Camera] shot of [subject] [action] in [environment]\".",
      "Image-to-video structure: \"The camera [motion] as the subject [action]\". Timed beats use timestamps like \"[00:01]\".",
      "No native audio or end frame documented for Gen-4.5 (unverified).",
    ],
    verifiedAt: VERIFIED_AT,
    sourceUrls: [
      "https://help.runwayml.com/hc/en-us/articles/42460036199443",
      "https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5",
      "https://academy.runwayml.com/guides/prompting-guide",
    ],
  },
} satisfies Record<ModelId, ModelConfigInput>;

function loadModels(rows: Record<ModelId, ModelConfigInput>): Readonly<Record<ModelId, ModelConfig>> {
  const parsed = {} as Record<ModelId, ModelConfig>;
  for (const id of MODEL_IDS) {
    const result = modelConfigSchema.safeParse(rows[id]);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join(".") || "(row)"}: ${i.message}`).join("; ");
      throw new Error(`models.config: invalid row "${id}": ${detail}`);
    }
    if (result.data.id !== id) throw new Error(`models.config: row "${id}" has id "${result.data.id}"`);
    parsed[id] = result.data;
  }
  return Object.freeze(parsed);
}

export const MODELS: Readonly<Record<ModelId, ModelConfig>> = loadModels(ROWS);

export function getModel(id: ModelId): ModelConfig {
  const model = MODELS[id];
  if (!model) throw new Error(`Unknown model id "${String(id)}"`);
  return model;
}

/**
 * Default model per role. Images (asset sheets, location plates) render on Nano Banana Pro. The main
 * 15 s ad is one multi-shot clip on Seedance 2.5 (Draft Mode first; Cinema Studio 4.0 shares the
 * template). Veo 3.1 renders scene by scene for tools that work per shot.
 */
/** The Claude model behind every Stoop LLM call (overridable with STOOP_MODEL). */
export const DEFAULT_LLM_MODEL_ID = "claude-sonnet-5-5";

export const ROLE_DEFAULTS = {
  image: "nano-banana-pro",
  multiShotVideo: "seedance-2-5",
  perSceneVideo: "veo-3-1",
} as const satisfies Record<string, ModelId>;

/**
 * Per-scene models every pack also writes prompts for, next to the settings' own per-scene model, so
 * a report offers copy-ready prompts for each tool. One job set per template family: the settings'
 * per-scene model wins its family. These sit outside PackSettings on purpose: adding one adds jobs
 * and leaves every existing job's hash unchanged.
 */
export const PER_SCENE_EXTRAS = ["kling-3", "runway-gen-4-5"] as const satisfies readonly ModelId[];

/**
 * The shortest length the model accepts that holds `seconds`. Models with fixed lengths (Veo 3.1:
 * 4, 6, 8) pick from those, and reference images force `refsRequireDuration`. Range models round up
 * and clamp to their minimum. Throws for image models, for references the model cannot take, and
 * when the scene is longer than the model's maximum (split it into shorter clips instead).
 */
export function renderLength(model: ModelConfig, seconds: number, opts: { hasRefs: boolean }): number {
  const d = model.durations;
  if (d === null) throw new Error(`${model.displayName} is an image model and has no duration`);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Scene length must be a positive number of seconds, got ${seconds}`);
  if (opts.hasRefs && !model.supportsImageRefs) throw new Error(`${model.displayName} does not take reference images`);
  if (seconds > d.max) throw new Error(`${model.displayName} renders at most ${d.max} s; ${seconds} s must be split into shorter clips`);
  const needed = opts.hasRefs && model.refsRequireDuration !== null ? Math.max(seconds, model.refsRequireDuration) : seconds;
  if (d.allowed) {
    const pick = d.allowed.find((length) => length >= needed);
    if (pick === undefined) throw new Error(`${model.displayName} has no allowed length of ${needed} s or more`);
    return pick;
  }
  return Math.min(d.max, Math.max(d.min, Math.ceil(needed)));
}

// Storyboard frames on fal ----------------------------------------------------------------------------
// Live runs render 4 stills per world as the cheap draft (lib/media/frames.ts). These are fal endpoint
// ids, as fal names them, so they are not ModelIds: the Production Pack never renders on fal, only the
// storyboard step does. Prices are fal's list prices on the pages above, for the cost estimate only.

export const FRAME_MODELS_VERIFIED_AT = "2026-10-17";

export const FRAME_MODEL_ROLES = ["edit", "text"] as const;
export type FrameModelRole = (typeof FRAME_MODEL_ROLES)[number];

export interface FrameModel {
  role: FrameModelRole;
  /** fal's endpoint id. */
  endpoint: string;
  displayName: string;
  /** Reference images it takes (0: text only). */
  maxRefs: number;
  /** Dollars per frame at the settings Stoop sends. */
  usdPerFrame: number;
  notes: string[];
  verifiedAt: typeof FRAME_MODELS_VERIFIED_AT;
  sourceUrls: string[];
}

export const FRAME_MODELS: Readonly<Record<FrameModelRole, FrameModel>> = Object.freeze({
  // The default: the product's own photo as the reference, so the product looks like itself.
  edit: {
    role: "edit",
    endpoint: "fal-ai/nano-banana-2/edit",
    displayName: "Nano Banana 2 Edit (fal)",
    maxRefs: 14,
    usdPerFrame: 0.08,
    notes: [
      "Input: prompt, image_urls (up to 14 references), num_images, aspect_ratio (9:16 among them), resolution (0.5K, 1K, 2K, 4K; default 1K), output_format (png, jpeg, webp).",
      "Output: images[] with url, content_type, width and height.",
      "$0.08 per image at 1K; 2K bills 1.5 times and 4K 2 times that. Every output carries a SynthID watermark.",
    ],
    verifiedAt: FRAME_MODELS_VERIFIED_AT,
    sourceUrls: ["https://fal.ai/models/fal-ai/nano-banana-2/edit/api", "https://fal.ai/models/fal-ai/nano-banana-2/edit"],
  },
  // The fast fallback for products known only from a text description (no photo to reference).
  text: {
    role: "text",
    endpoint: "fal-ai/flux/schnell",
    displayName: "FLUX.1 [schnell] (fal)",
    maxRefs: 0,
    // $0.003 per megapixel, rounded up: a portrait_16_9 frame (576 x 1024) bills as 1 megapixel.
    usdPerFrame: 0.003,
    notes: [
      "Input: prompt, image_size (portrait_16_9 is the 9:16 preset), num_inference_steps (default 4), num_images, output_format (jpeg, png), enable_safety_checker (default true).",
      "Output: images[] with url, width, height and content_type, plus has_nsfw_concepts.",
      "$0.003 per megapixel, rounded up to the nearest megapixel.",
    ],
    verifiedAt: FRAME_MODELS_VERIFIED_AT,
    sourceUrls: ["https://fal.ai/models/fal-ai/flux/schnell/api", "https://fal.ai/models/fal-ai/flux/schnell"],
  },
});

// Draft video on fal -------------------------------------------------------------------------------
// The one public video path (CLAUDE.md section 6): a 480p draft of the kept concept, rendered on fal
// either with the visitor's own fal key (BYOK, from the browser) or, with a judge pass, Stoop's key.
// Never Higgsfield. fal endpoint ids, so not ModelIds. Prices are fal's published approximations (fal
// bills by tokens), for the estimate shown before a render and for the caps.

export const VIDEO_MODELS_VERIFIED_AT = "2026-10-17";

export const VIDEO_MODEL_ROLES = ["reference", "image"] as const;
export type VideoModelRole = (typeof VIDEO_MODEL_ROLES)[number];

export interface VideoModel {
  role: VideoModelRole;
  /** fal's endpoint id. */
  endpoint: string;
  displayName: string;
  /** Reference images it takes, named @Image1..N in the prompt (image-to-video: a start frame, plus an optional end frame). */
  maxRefs: number;
  /** Approximate dollars per second of generated 480p video, with audio. */
  usdPerSecond480p: number;
  minSeconds: number;
  maxSeconds: number;
  /** Whether aspect_ratio can be set (image-to-video always follows its start frame). */
  setsAspectRatio: boolean;
  notes: string[];
  verifiedAt: typeof VIDEO_MODELS_VERIFIED_AT;
  sourceUrls: string[];
}

export const VIDEO_MODELS: Readonly<Record<VideoModelRole, VideoModel>> = Object.freeze({
  // The default: the storyboard frames and the product image as references, so the draft follows the board.
  reference: {
    role: "reference",
    endpoint: "bytedance/seedance-2.5/reference-to-video",
    displayName: "Seedance 2.5 reference to video (fal)",
    maxRefs: 30,
    usdPerSecond480p: 0.2205,
    minSeconds: 4,
    maxSeconds: 30,
    setsAspectRatio: true,
    notes: [
      "Input: prompt, task (reference by default), image_urls (up to 30, referenced as @Image1..N), resolution (480p, 720p, 1080p; default 720p), draft (a 480p preview that overrides resolution and returns a draft_id, completable at 1080p within 7 days), duration (auto or 4 to 30), aspect_ratio (9:16 among them), generate_audio (default true), seed, end_user_id.",
      "Output: video (url, content_type, file_name, file_size), seed, draft_id.",
      "About $0.2205 per second at 480p with audio; image references are not billed. Billing is token-based, so the per-second figure is fal's approximation.",
      "Face filtering of reference images is not documented: test it before relying on frames with people.",
    ],
    verifiedAt: VIDEO_MODELS_VERIFIED_AT,
    sourceUrls: ["https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api", "https://fal.ai/models/bytedance/seedance-2.5/reference-to-video"],
  },
  // The fallback when references are refused: one product-only frame as the start frame.
  image: {
    role: "image",
    endpoint: "bytedance/seedance-2.5/image-to-video",
    displayName: "Seedance 2.5 image to video (fal)",
    maxRefs: 2,
    usdPerSecond480p: 0.2205,
    minSeconds: 4,
    maxSeconds: 30,
    setsAspectRatio: false,
    notes: [
      "Input: prompt, image_url (the start frame), end_image_url, resolution, draft, duration (auto or 4 to 30), aspect_ratio (always auto: it follows the start frame), generate_audio (same cost either way), end_user_id. No seed input.",
      "Output: video (url, content_type, file_name, file_size), seed, draft_id.",
    ],
    verifiedAt: VIDEO_MODELS_VERIFIED_AT,
    sourceUrls: ["https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api"],
  },
});

/** The estimate shown before a draft renders, in dollars. */
export const draftUsd = (model: VideoModel, seconds: number) => Math.round(model.usdPerSecond480p * seconds * 100) / 100;

// Camera presets ---------------------------------------------------------------------------------
// Camera moves are always creative or interpreted cues, never Qloo data. Each preset will later get a
// looping preview card in the UI. Phrasings carry no trailing period, so a template can end the
// sentence or continue it (Runway: "The camera ... as the subject ..."). Seedance phrasing starts with
// Higgsfield's preset name where one exists (https://higgsfield.ai/camera-controls); Veo and Kling get
// plain camera language; nano-banana (stills) gets the matching framing or composition.

export const CAMERA_PRESET_IDS = [
  "static",
  "handheld",
  "dolly_in",
  "dolly_out",
  "push_in_slow",
  "pull_out_reveal",
  "tracking_side",
  "orbit",
  "crash_zoom_in",
  "whip_pan",
  "fpv_drone",
  "snorricam",
  "dolly_zoom",
  "object_pov",
  "overhead_top_down",
  "tilt_up_reveal",
] as const;
export type CameraPresetId = (typeof CAMERA_PRESET_IDS)[number];

export interface CameraPreset {
  label: string;
  /** One line for the concept writer and the preview card. */
  description: string;
  phrasing: Record<TemplateFamily, string>;
}

export const CAMERA_PRESETS: Readonly<Record<CameraPresetId, CameraPreset>> = {
  static: {
    label: "Static",
    description: "Locked-off camera, no movement. Lets the action carry the shot.",
    phrasing: {
      seedance: "Static, locked-off camera with no movement",
      veo: "Static locked-off shot on a tripod",
      kling: "static locked-off camera",
      runway: "The camera stays locked off and still",
      "nano-banana": "Locked-off eye-level frame with the subject centered",
    },
  },
  handheld: {
    label: "Handheld",
    description: "Handheld with a light natural shake. Feels candid and close.",
    phrasing: {
      seedance: "Handheld, light natural shake",
      veo: "Handheld shot with a subtle natural shake",
      kling: "handheld camera with a light natural shake",
      runway: "The handheld camera drifts with a slight natural shake",
      "nano-banana": "Candid handheld snapshot framing, slightly off-center",
    },
  },
  dolly_in: {
    label: "Dolly in",
    description: "The camera glides toward the subject. Builds focus.",
    phrasing: {
      seedance: "Dolly In, the camera glides toward the subject",
      veo: "Smooth dolly-in toward the subject",
      kling: "smooth dolly in toward the subject",
      runway: "The camera dollies in toward the subject",
      "nano-banana": "Medium close-up with the subject filling most of the frame",
    },
  },
  dolly_out: {
    label: "Dolly out",
    description: "The camera glides back from the subject. Opens up the scene.",
    phrasing: {
      seedance: "Dolly Out, the camera glides back from the subject",
      veo: "Smooth dolly-out away from the subject",
      kling: "smooth dolly out away from the subject",
      runway: "The camera dollies back away from the subject",
      "nano-banana": "Medium-wide frame with open space around the subject",
    },
  },
  push_in_slow: {
    label: "Slow push-in",
    description: "A very slow push toward the subject. Quiet tension or a product reveal.",
    phrasing: {
      seedance: "Slow push-in, the camera creeps toward the subject",
      veo: "Very slow push-in on the subject",
      kling: "very slow push in on the subject",
      runway: "The camera slowly pushes in",
      "nano-banana": "Tight close-up with shallow depth of field on the subject",
    },
  },
  pull_out_reveal: {
    label: "Pull-out reveal",
    description: "Starts close, then pulls back to reveal the whole setting.",
    phrasing: {
      seedance: "Pull-out reveal, the camera pulls back to show the whole setting",
      veo: "Slow pull-back that reveals the full setting",
      kling: "camera pulls back to reveal the full setting",
      runway: "The camera pulls back to reveal the setting",
      "nano-banana": "Wide establishing frame with the subject small in the setting",
    },
  },
  tracking_side: {
    label: "Side tracking",
    description: "The camera moves sideways alongside a moving subject.",
    phrasing: {
      seedance: "Side tracking shot, the camera moves alongside the subject",
      veo: "Lateral tracking shot moving alongside the subject",
      kling: "camera tracks sideways alongside the subject",
      runway: "The camera tracks sideways alongside the subject",
      "nano-banana": "Side-profile frame with the subject mid-stride, motion implied",
    },
  },
  orbit: {
    label: "Orbit",
    description: "The camera circles the subject. Shows the product from every side.",
    phrasing: {
      seedance: "360 Orbit, the camera circles the subject",
      veo: "Slow orbit around the subject",
      kling: "camera orbits slowly around the subject",
      runway: "The camera orbits around the subject",
      "nano-banana": "Three-quarter angle on the subject",
    },
  },
  crash_zoom_in: {
    label: "Crash zoom",
    description: "A sudden fast zoom onto the subject. A hard hook or punchline.",
    phrasing: {
      seedance: "Crash Zoom In, a sudden fast zoom onto the subject",
      veo: "Sudden crash zoom onto the subject",
      kling: "sudden fast zoom in onto the subject",
      runway: "The camera snaps into a fast zoom on the subject",
      "nano-banana": "Extreme close-up, tightly cropped on the subject",
    },
  },
  whip_pan: {
    label: "Whip pan",
    description: "A fast blurred pan that snaps to the next subject. Good for transitions.",
    phrasing: {
      seedance: "Whip Pan, a fast blurred pan to the next subject",
      veo: "Fast whip pan with motion blur",
      kling: "fast whip pan with motion blur",
      runway: "The camera whip pans quickly with motion blur",
      "nano-banana": "Dynamic frame with directional motion blur at one edge",
    },
  },
  fpv_drone: {
    label: "FPV drone",
    description: "A low, fast, swooping fly-through of the setting.",
    phrasing: {
      seedance: "FPV Drone, a low, fast, swooping fly-through",
      veo: "FPV drone shot flying low and fast through the scene",
      kling: "FPV drone flies low and fast through the scene",
      runway: "The camera flies low and fast through the scene like an FPV drone",
      "nano-banana": "Low, wide aerial angle sweeping over the scene",
    },
  },
  snorricam: {
    label: "Snorricam",
    description: "The camera is rigged to the subject: they stay fixed while the world moves.",
    phrasing: {
      seedance: "Snorricam, the camera is rigged to the subject so they stay fixed while the world moves",
      veo: "Body-mounted snorricam shot, the subject stays fixed in frame while the background moves",
      kling: "body-mounted camera keeps the subject fixed while the background moves",
      runway: "The camera stays locked to the subject's body while the background moves",
      "nano-banana": "Close frontal frame from chest height with a motion-blurred background",
    },
  },
  dolly_zoom: {
    label: "Dolly zoom",
    description: "The subject holds size while the background stretches. A moment of realization.",
    phrasing: {
      seedance: "Dolly Zoom In, the background stretches while the subject stays the same size",
      veo: "Dolly zoom, the subject holds size while the background warps",
      kling: "dolly zoom, the subject holds size while the background stretches",
      runway: "The camera dolly zooms so the background stretches while the subject holds size",
      "nano-banana": "Compressed telephoto look with the background looming behind the subject",
    },
  },
  object_pov: {
    label: "Object POV",
    description: "The view from an object looking out at the subject.",
    phrasing: {
      seedance: "Object POV, the scene seen from an object's point of view",
      veo: "Point-of-view shot from an object looking out at the subject",
      kling: "point of view from an object looking at the subject",
      runway: "The camera looks out from an object's point of view at the subject",
      "nano-banana": "Point-of-view frame from an object looking up at the subject",
    },
  },
  overhead_top_down: {
    label: "Overhead",
    description: "Straight down from above. Clean for products on a surface.",
    phrasing: {
      seedance: "Overhead, a top-down view looking straight down",
      veo: "Overhead top-down shot looking straight down",
      kling: "overhead top-down camera looking straight down",
      runway: "The camera looks straight down from overhead",
      "nano-banana": "Top-down flat-lay composition shot from directly above",
    },
  },
  tilt_up_reveal: {
    label: "Tilt-up reveal",
    description: "The camera tilts up to reveal the subject.",
    phrasing: {
      seedance: "Tilt Up, the camera tilts up to reveal the subject",
      veo: "Slow tilt up that reveals the subject",
      kling: "camera tilts up to reveal the subject",
      runway: "The camera tilts up to reveal the subject",
      "nano-banana": "Low angle looking up at the subject",
    },
  },
};

// Look and energy presets ---------------------------------------------------------------------------
// For animated looks, Qloo's visual language still sets palette, grade and pacing; the lens and grain
// lines drop out because they describe a physical camera.

export interface LookPreset {
  label: string;
  /** One phrase for the GLOBAL STYLE line. Empty for auto. */
  globalStyle: string;
  /** False when lens and grain lines should be dropped from the prompt. */
  keepsLensAndGrain: boolean;
}

export const LOOK_PRESETS: Readonly<Record<Look, LookPreset>> = {
  auto: { label: "Auto", globalStyle: "", keepsLensAndGrain: true },
  live_action: {
    label: "Live action",
    globalStyle: "Photoreal live-action footage, natural skin texture, real-world lighting",
    keepsLensAndGrain: true,
  },
  animation_2d: {
    label: "2D animation",
    globalStyle: "Hand-drawn 2D animation, clean line work, flat cel shading",
    keepsLensAndGrain: false,
  },
  animation_3d: {
    label: "3D animation",
    globalStyle: "Stylized 3D animation, soft global illumination, smooth rounded forms",
    keepsLensAndGrain: false,
  },
  stop_motion: {
    label: "Stop motion",
    globalStyle: "Stop-motion animation, handmade miniature sets, tactile materials, slightly stepped motion",
    keepsLensAndGrain: false,
  },
  illustrated: {
    label: "Illustrated",
    globalStyle: "Illustrated look, painterly textures with visible brush strokes, storybook framing",
    keepsLensAndGrain: false,
  },
};

export interface EnergyPreset {
  label: string;
  /** One pacing phrase for the prompt. Empty for auto. */
  pacing: string;
}

export const ENERGY_PRESETS: Readonly<Record<Energy, EnergyPreset>> = {
  auto: { label: "Auto", pacing: "" },
  calm: { label: "Calm", pacing: "Unhurried pacing with long holds and gentle transitions" },
  upbeat: { label: "Upbeat", pacing: "Brisk pacing with a new beat about every 2 seconds" },
  high: { label: "High", pacing: "Fast pacing with quick cuts about every second and bursts of motion" },
};
