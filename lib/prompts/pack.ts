// Builds a Production Pack: asset prompts with fixed filenames, render jobs (one multi-shot clip, plus
// optional per-scene clips), a readable shot list, the critique checklist and the Director's Guide.
// Every asset and render job carries a promptHash; an approval in public/demo/approvals.json pins one.
// Product assets come from the product and settings alone, so the Control and the culture-made packs
// share them byte for byte.
import { z } from "zod";
import { AVOID_LIST_EXEMPT, checkText, FAMOUS_PLACES, type GuardIssue } from "../guardrails";
import { hashOf } from "../hash";
import { CASTS } from "../types";
import { briefCueTexts, conceptSchema, packSettingsSchema, type BriefSlots, type Concept, type PackSettings, type ProductSpec } from "./brief";
import { AI_DISCLOSURE_NOTE, CHECKLIST_CONDITIONS, CHECKLIST_STAGES, checklistFor, HUMAN_REVIEW_CHECKLIST, type ChecklistItem } from "./critique-checklist";
import { renderDirectorGuide } from "./director-guide";
import { renderLocationPlate, renderMultiShot, renderPackshot, renderProductSheet, renderTalentSheet } from "./higgsfield";
import { renderKlingMultiShot, renderKlingShot } from "./kling";
import { FILES, negativeNouns, productFiles, resolveCast, sourcePhotos, usesSourcePhotos, type ResolvedCast } from "./lines";
import { renderShotList } from "./master";
import { getModel, MODEL_IDS, PER_SCENE_EXTRAS, renderLength, type ModelConfig, type ModelId, type TemplateFamily } from "./models.config";
import { renderRunwayScene } from "./runway";
import { estimateTokens, renderScene } from "./veo";

/**
 * Families whose scene jobs chain by start frames: each scene starts from the previous scene's last
 * frame while the location holds, otherwise from its location plate. Kling: Higgsfield's Kling page
 * ("use the last frame of one scene as the next scene's start frame"). Runway: 9:16 needs a start
 * frame, and its guide chains longer sequences by last frames.
 */
const CHAINED_FAMILIES: ReadonlySet<TemplateFamily> = new Set(["kling", "runway"]);

/**
 * A model that takes no reference images sees the product only through the prompt's words, so it can
 * show a product described in text, but not one known only from the brand's photos.
 */
const canShowProduct = (model: ModelConfig, product: ProductSpec) => model.supportsImageRefs || product.source.kind === "description";

/**
 * The settings' per-scene model, then the extras, one per template family. An extra that cannot show
 * this product is skipped (Runway with a brand's photos), so the pack never offers a prompt whose
 * product the model would invent.
 */
function sceneModels(perScene: ModelConfig | null, product: ProductSpec): { models: ModelConfig[]; skipped: ModelConfig[] } {
  const models: ModelConfig[] = perScene ? [perScene] : [];
  const skipped: ModelConfig[] = [];
  for (const model of PER_SCENE_EXTRAS.map(getModel)) {
    if (models.some((m) => m.template === model.template)) continue;
    if (canShowProduct(model, product)) models.push(model);
    else skipped.push(model);
  }
  return { models, skipped };
}

export const ASSET_KINDS = ["packshot", "product_sheet", "talent_sheet", "location"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface PackAsset {
  file: string;
  kind: AssetKind;
  modelId: ModelId;
  aspect: string;
  prompt: string;
  /** Filenames of other assets, or source-image URLs, used as references. */
  refs: string[];
  /** For tools with a negative field: unwanted nouns. */
  negative: string | null;
  promptHash: string;
}

/**
 * Where an image-to-video job starts: one of the pack's assets (a location plate, Runway's start frame)
 * or the last frame of an earlier job (Kling's shot chaining). Null for jobs that start from the prompt.
 */
export type StartFrame = { kind: "asset"; file: string } | { kind: "last-frame"; job: string };

export interface RenderJob {
  id: string;
  kind: "multi-shot" | "scene";
  modelId: ModelId;
  sceneIndexes: number[];
  /** Length to request from the model (may be longer than the scene; trim in the edit). */
  renderSeconds: number;
  /** Length the clip is cut to in the edit. */
  trimTo: number;
  refs: string[];
  prompt: string;
  negative: string | null;
  startFrame: StartFrame | null;
  promptHash: string;
}

export interface ProductionPack {
  version: 1;
  templateVersion: number;
  productSlug: string;
  segmentId: string;
  segmentLabel: string;
  cast: ResolvedCast;
  settings: PackSettings;
  settingsHash: string;
  assets: PackAsset[];
  concept: Concept;
  renders: RenderJob[];
  shotList: string;
  overlays: { scene: number; text: string }[];
  /** A brand's own product photos used directly as references (photo-real looks only). */
  sourcePhotos: { file: string; url: string }[];
  /** The music brief for the edit: finals get a licensed track that matches it. */
  musicForEdit: string;
  checklist: ChecklistItem[];
  directorGuide: string;
  reviewChecklist: readonly string[];
  disclosure: string;
}

const promptHash = z.string().regex(/^[0-9a-f]{64}$/);

/** The pack as the Report stores it, so a stored or streamed pack is validated like everything else. */
export const productionPackSchema: z.ZodType<ProductionPack> = z.strictObject({
  version: z.literal(1),
  templateVersion: z.number().int().min(1),
  productSlug: z.string().min(1),
  segmentId: z.string().regex(/^[a-z0-9-]+$/),
  segmentLabel: z.string().min(1),
  cast: z.enum(CASTS).exclude(["auto"]),
  settings: packSettingsSchema,
  settingsHash: promptHash,
  assets: z.array(
    z.strictObject({
      file: z.string().min(1),
      kind: z.enum(ASSET_KINDS),
      modelId: z.enum(MODEL_IDS),
      aspect: z.string().min(1),
      prompt: z.string().min(1),
      refs: z.array(z.string().min(1)),
      negative: z.string().nullable(),
      promptHash,
    }),
  ),
  concept: conceptSchema,
  renders: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: z.enum(["multi-shot", "scene"]),
      modelId: z.enum(MODEL_IDS),
      sceneIndexes: z.array(z.number().int().min(0)),
      renderSeconds: z.number().positive(),
      trimTo: z.number().positive(),
      refs: z.array(z.string().min(1)),
      prompt: z.string().min(1),
      negative: z.string().nullable(),
      startFrame: z
        .discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("asset"), file: z.string().min(1) }),
          z.strictObject({ kind: z.literal("last-frame"), job: z.string().min(1) }),
        ])
        .nullable(),
      promptHash,
    }),
  ),
  shotList: z.string().min(1),
  overlays: z.array(z.strictObject({ scene: z.number().int().min(0), text: z.string().min(1) })),
  sourcePhotos: z.array(z.strictObject({ file: z.string().min(1), url: z.url({ protocol: /^https$/ }) })),
  musicForEdit: z.string().min(1),
  checklist: z.array(
    z.strictObject({
      id: z.string().min(1),
      text: z.string().min(1),
      appliesTo: z.array(z.enum(CHECKLIST_STAGES)),
      blocking: z.boolean(),
      when: z.enum(CHECKLIST_CONDITIONS),
    }),
  ),
  directorGuide: z.string().min(1),
  reviewChecklist: z.array(z.string().min(1)),
  disclosure: z.string().min(1),
});

const IMAGE_ASPECT = { packshot: "1:1", product_sheet: "16:9", talent_sheet: "16:9", location: "9:16" } as const;

function assetHash(settings: PackSettings, model: ModelConfig, aspect: string, prompt: string, refs: string[], refHashes: string[]): string {
  return hashOf({
    templateVersion: settings.templateVersion,
    modelId: model.id,
    aspect,
    direction: settings.direction,
    refs: [...refs].sort(),
    refHashes: [...refHashes].sort(),
    prompt,
  });
}

function asset(
  settings: PackSettings,
  model: ModelConfig,
  file: string,
  kind: AssetKind,
  rendered: { prompt: string; refs: string[] },
  known: Map<string, string>,
): PackAsset {
  const aspect = IMAGE_ASPECT[kind];
  const refHashes = rendered.refs.map((ref) => known.get(ref)).filter((hash): hash is string => Boolean(hash));
  const negative = negativeNouns(model, kind === "location" ? "plate" : "scene");
  return {
    file,
    kind,
    modelId: model.id,
    aspect,
    prompt: rendered.prompt,
    refs: rendered.refs,
    negative,
    promptHash: assetHash(settings, model, aspect, rendered.prompt + (negative ? `\nNEGATIVE: ${negative}` : ""), rendered.refs, refHashes),
  };
}

/**
 * The product's own assets, shared by every pack of a product:
 * - described in text: a packshot, then a product sheet drawn from it
 * - real photos and a photo-real look: nothing to generate, the photos are the references
 * - real photos and an animated look: a product sheet redrawn from the photos in that look
 */
export function buildProductAssets(product: ProductSpec, settings: PackSettings): PackAsset[] {
  if (usesSourcePhotos(product, settings.direction)) return [];
  const model = getModel(settings.models.image);
  const known = new Map<string, string>();
  const assets: PackAsset[] = [];
  if (product.source.kind === "description") {
    const packshot = asset(settings, model, FILES.packshot, "packshot", renderPackshot(model, product), known);
    known.set(packshot.file, packshot.promptHash);
    assets.push(packshot);
  }
  assets.push(asset(settings, model, FILES.productSheet, "product_sheet", renderProductSheet(model, product, settings), known));
  return assets;
}

export interface PackInput {
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  settings: PackSettings;
}

export function buildProductionPack({ product, brief, concept, settings }: PackInput): ProductionPack {
  const imageModel = getModel(settings.models.image);
  const multiShotModel = getModel(settings.models.multiShot);
  const perSceneModel = settings.models.perScene ? getModel(settings.models.perScene) : null;
  const cast = resolveCast(settings.direction, brief);

  const assets = buildProductAssets(product, settings);
  const photos = usesSourcePhotos(product, settings.direction) ? sourcePhotos(product) : [];
  const productRefs = productFiles(product, settings.direction);
  // A photo's URL stands in for its hash: a different photo means a different approval.
  const known = new Map<string, string>([...assets.map((a) => [a.file, a.promptHash] as const), ...photos.map((p) => [p.file, p.url] as const)]);
  const add = (a: PackAsset) => {
    known.set(a.file, a.promptHash);
    assets.push(a);
  };
  if (cast === "adult_talent") {
    add(asset(settings, imageModel, FILES.talentSheet(brief.segment.id), "talent_sheet", renderTalentSheet(imageModel, brief, settings), known));
  }
  for (const place of concept.locations) {
    add(asset(settings, imageModel, FILES.location(brief.segment.id, place.slug), "location", renderLocationPlate(imageModel, brief, place, settings), known));
  }

  // Models that take few references get one product file; the rest get every product photo.
  const productRefsFor = (model: ModelConfig) => (model.maxRefs > 3 ? productRefs : productRefs.slice(0, 1));
  const talentRefs = cast === "adult_talent" ? [FILES.talentSheet(brief.segment.id)] : [];
  const locationFile = (index: number) => FILES.location(brief.segment.id, concept.scenes[index].location);
  const sceneRefs = (products: string[], indexes: number[]) => {
    const refs: string[] = [...products, ...talentRefs];
    for (const index of indexes) {
      const file = locationFile(index);
      if (!refs.includes(file)) refs.push(file);
    }
    return refs;
  };

  const jobHashes = new Map<string, string>();
  const job = (id: string, kind: RenderJob["kind"], model: ModelConfig, indexes: number[], prompt: string, opts: { refs?: string[]; startFrame?: StartFrame | null } = {}): RenderJob => {
    const refs = opts.refs ?? sceneRefs(productRefsFor(model), indexes);
    const startFrame = opts.startFrame ?? null;
    const trimTo = indexes.reduce((sum, index) => sum + concept.scenes[index].seconds, 0);
    const renderSeconds = renderLength(model, trimTo, { hasRefs: refs.length > 0 && model.supportsImageRefs });
    const negative = negativeNouns(model, "scene");
    // A start frame is hashed with what it shows: the plate's hash, or the earlier job's hash.
    const startHash = startFrame ? (startFrame.kind === "asset" ? (known.get(startFrame.file) ?? startFrame.file) : (jobHashes.get(startFrame.job) ?? startFrame.job)) : null;
    const render: RenderJob = {
      id,
      kind,
      modelId: model.id,
      sceneIndexes: indexes,
      renderSeconds,
      trimTo,
      refs,
      prompt,
      negative,
      startFrame,
      promptHash: hashOf({
        templateVersion: settings.templateVersion,
        modelId: model.id,
        aspect: settings.aspect,
        seconds: renderSeconds,
        direction: settings.direction,
        refs: [...refs].sort(),
        refHashes: refs.map((ref) => known.get(ref) ?? ref).sort(),
        prompt: prompt + (negative ? `\nNEGATIVE: ${negative}` : ""),
        // Only jobs that start from a frame hash it, so prompt-only jobs keep their hashes.
        ...(startFrame ? { startFrame: { ...startFrame, hash: startHash } } : {}),
      }),
    };
    jobHashes.set(id, render.promptHash);
    return render;
  };

  const all = concept.scenes.map((_, index) => index);
  const multiShotPrompt = (() => {
    switch (multiShotModel.template) {
      case "seedance":
        return renderMultiShot({ model: multiShotModel, product, brief, concept, settings, cast, productRefs: productRefsFor(multiShotModel) });
      case "kling":
        return renderKlingMultiShot({ model: multiShotModel, product, brief, concept, settings, cast, productRef: productRefs[0] });
      default:
        throw new Error(`${multiShotModel.displayName} has no multi-shot template; pick it as the per-scene model.`);
    }
  })();
  // Kling's Elements count against its reference limit, so it gets one product file.
  const multiShotRefs = multiShotModel.template === "kling" ? sceneRefs(productRefs.slice(0, 1), all) : undefined;
  const renders: RenderJob[] = [job(`${multiShotModel.template}-${settings.seconds}s`, "multi-shot", multiShotModel, all, multiShotPrompt, { refs: multiShotRefs })];

  const scenes = sceneModels(perSceneModel, product);
  for (const model of scenes.models) {
    const id = (index: number) => `${model.template}-scene-${index + 1}`;
    const chained = CHAINED_FAMILIES.has(model.template);
    for (const index of all) {
      // Chained families start every scene from a frame: the previous scene's last frame while the
      // location holds, otherwise this scene's location plate.
      const sameLocation = index > 0 && concept.scenes[index - 1].location === concept.scenes[index].location;
      const start = chained ? (sameLocation ? "previous" : "plate") : null;
      const startFrame: StartFrame | null = start === "previous" ? { kind: "last-frame", job: id(index - 1) } : start === "plate" ? { kind: "asset", file: locationFile(index) } : null;
      const input = { model, product, brief, concept, settings, cast, sceneIndex: index };
      switch (model.template) {
        case "veo":
          renders.push(job(id(index), "scene", model, [index], renderScene({ ...input, productRef: productRefs[0] })));
          break;
        case "kling":
          // The location comes in as the start frame, so the references are the Elements only.
          renders.push(job(id(index), "scene", model, [index], renderKlingShot({ ...input, productRef: productRefs[0], start }), { refs: [productRefs[0], ...talentRefs], startFrame }));
          break;
        case "runway":
          // No reference images: the start frame is the only image the model sees.
          renders.push(job(id(index), "scene", model, [index], renderRunwayScene({ ...input, start: start ?? "plate" }), { refs: [], startFrame }));
          break;
        default:
          throw new Error(`${model.displayName} has no per-scene template; it renders the whole ad as one multi-shot clip.`);
      }
    }
  }

  const checklist = checklistFor({
    hasTalent: cast === "adult_talent",
    hasSourceImages: product.source.kind === "images",
    cast: settings.direction.cast === "auto" ? cast : settings.direction.cast,
  });

  return {
    version: 1,
    templateVersion: settings.templateVersion,
    productSlug: product.slug,
    segmentId: brief.segment.id,
    segmentLabel: brief.segment.label,
    cast,
    settings,
    settingsHash: hashOf(settings),
    assets,
    concept,
    renders,
    shotList: renderShotList(product, brief, concept, settings, cast),
    overlays: concept.scenes.flatMap((scene, index) => (scene.overlayText ? [{ scene: index + 1, text: scene.overlayText }] : [])),
    sourcePhotos: photos,
    musicForEdit: brief.music.text,
    checklist,
    directorGuide: renderDirectorGuide({
      imageModel,
      draftModel: multiShotModel,
      finalModel: multiShotModel,
      perSceneModel: perSceneModel ?? undefined,
      extraSceneModels: scenes.models.filter((model) => model.id !== perSceneModel?.id),
      skippedSceneModels: scenes.skipped,
      checklist,
      takesPerPrompt: 1,
      maxRevisions: 1,
    }),
    reviewChecklist: HUMAN_REVIEW_CHECKLIST,
    disclosure: AI_DISCLOSURE_NOTE,
  };
}

export interface PackProblem {
  where: string;
  message: string;
}

export interface CheckOptions {
  /** Brief slots Qloo backed richly (World.richSlots). A render prompt that drops one fails with its own message. Empty for the Control. */
  richSlots: readonly string[];
}

/** How a slot reads in a problem message: "music", "first setting". */
function slotLabel(slot: string): string {
  const setting = /^setting\.(\d)$/.exec(slot);
  if (setting) return `${["first", "second", "third"][Number(setting[1])] ?? `setting ${setting[1]}`} setting`;
  return ({ productRole: "product role", visual: "visual language", "voice.tone": "voice" } as Record<string, string>)[slot] ?? slot;
}

/** "the Kling 3.0 scene 2 prompt", "the Seedance 2.5 multi-shot prompt". */
function promptLabel(render: RenderJob): string {
  const name = getModel(render.modelId).displayName;
  return render.kind === "multi-shot" ? `the ${name} multi-shot prompt` : `the ${name} scene ${render.sceneIndexes.map((i) => i + 1).join(", ")} prompt`;
}

/**
 * Deterministic checks on a finished pack. An empty list means it passes.
 * - every cue the brief carries appears word for word in every render prompt
 * - every slot in richSlots appears in every render prompt (the hard requirement for Qloo's rich
 *   fields, with its own message naming the prompt and the slot)
 * - a render whose model takes references references the product file, within the model's limit;
 *   one whose model takes none names the product in words
 * - a start frame names an asset of the pack or an earlier job, and a Runway job always has one
 * - prompts stay under the model's token cap
 * - no guardrail issue (names, minors, ethnicity, likeness, claims) in any prompt
 * - a source photo that shows a person is never a reference
 */
export function checkPack(pack: ProductionPack, brief: BriefSlots, product: ProductSpec, names: readonly string[], { richSlots }: CheckOptions): PackProblem[] {
  const problems: PackProblem[] = [];
  const allCues = briefCueTexts(brief);
  // The talent cue only reaches prompts that cast talent.
  const reachesPrompts = (slot: string) => slot !== "talent" || pack.cast === "adult_talent";
  const cues = allCues.filter((cue) => reachesPrompts(cue.slot));
  // Case-insensitive and without closing punctuation: a cue that opens a sentence is capitalized,
  // and one placed mid-sentence loses its full stop.
  const normalize = (text: string) => text.trim().replace(/[.!?]+$/, "").toLowerCase();
  const productRef = productFiles(product, pack.settings.direction)[0];
  const rich = [...new Set(richSlots)].filter(reachesPrompts);
  for (const slot of rich) {
    if (!allCues.some((cue) => cue.slot === slot)) {
      problems.push({ where: "brief", message: `Qloo backed the ${slotLabel(slot)} richly, but the brief carries no ${slotLabel(slot)} cue` });
    }
  }
  const assetFiles = new Set(pack.assets.map((a) => a.file));

  pack.renders.forEach((render, position) => {
    const model = getModel(render.modelId);
    const promptText = render.prompt.toLowerCase();
    for (const cue of cues) {
      if (!promptText.includes(normalize(cue.text))) problems.push({ where: render.id, message: `drops the brief's ${cue.slot} cue` });
    }
    for (const slot of rich) {
      const cue = allCues.find((c) => c.slot === slot);
      if (cue && !promptText.includes(normalize(cue.text))) {
        problems.push({ where: render.id, message: `${promptLabel(render)} drops the ${slotLabel(slot)} cue Qloo backed richly` });
      }
    }
    if (model.supportsImageRefs) {
      if (!render.refs.includes(productRef) || !render.prompt.includes(productRef)) problems.push({ where: render.id, message: `does not reference ${productRef}` });
      if (render.refs.length > model.maxRefs) problems.push({ where: render.id, message: `uses ${render.refs.length} references; the model takes ${model.maxRefs}` });
    } else if (!promptText.includes(product.name.toLowerCase())) {
      problems.push({ where: render.id, message: `does not name the ${product.name}; the model takes no reference images` });
    } else if (!canShowProduct(model, product)) {
      problems.push({ where: render.id, message: "takes no reference images, and this product is known only from the brand's photos, so the model would invent its look" });
    }
    const start = render.startFrame;
    if (start?.kind === "asset" && !assetFiles.has(start.file)) problems.push({ where: render.id, message: `starts from ${start.file}, which the pack does not have` });
    if (start?.kind === "last-frame" && !pack.renders.slice(0, position).some((r) => r.id === start.job)) {
      problems.push({ where: render.id, message: `starts from the last frame of ${start.job}, which does not come before it` });
    }
    if (model.template === "runway" && !start) problems.push({ where: render.id, message: "needs a start frame: text-to-video renders 16:9 only" });
    if (model.maxPromptTokens !== null && estimateTokens(render.prompt) > model.maxPromptTokens) {
      problems.push({ where: render.id, message: `is about ${estimateTokens(render.prompt)} tokens; the cap is ${model.maxPromptTokens}` });
    }
  });

  const people = new Set(product.source.kind === "images" ? product.source.images.filter((i) => i.showsPerson).map((i) => i.url) : []);
  const allowedNames = [...brief.allowedPlaces, ...(product.brandName ? [product.brandName] : [])];
  const texts: { where: string; text: string }[] = [
    ...pack.assets.map((a) => ({ where: a.file, text: a.prompt })),
    ...pack.renders.map((r) => ({ where: r.id, text: r.prompt })),
    // The shot list's "avoid" items name banned things on purpose; they are checked for real names below.
    { where: "shot list", text: pack.shotList.replace(/; avoid: [^\n]*/, "") },
  ];
  for (const item of brief.voice.avoid) {
    for (const issue of checkText(item, { names: [...names, ...FAMOUS_PLACES], allowedNames })) {
      if (!AVOID_LIST_EXEMPT.has(issue.rule)) problems.push({ where: "shot list", message: issue.message });
    }
  }
  for (const photo of pack.sourcePhotos) {
    if (people.has(photo.url)) problems.push({ where: photo.file, message: "uses a source photo that shows a person" });
  }
  for (const { where, text } of texts) {
    for (const issue of checkText(text, { names: [...names, ...FAMOUS_PLACES], allowedNames }) as GuardIssue[]) {
      problems.push({ where, message: issue.message });
    }
  }
  for (const a of pack.assets) {
    for (const ref of a.refs) if (people.has(ref)) problems.push({ where: a.file, message: "uses a source photo that shows a person" });
  }
  return problems;
}

/** Every hash a founder approves for one pack: assets first, then render jobs. */
export function packHashes(pack: ProductionPack): { id: string; promptHash: string }[] {
  return [
    ...pack.assets.map((a) => ({ id: `${pack.productSlug}/${a.file}`, promptHash: a.promptHash })),
    ...pack.renders.map((r) => ({ id: `${pack.productSlug}/${pack.segmentId}/${r.id}`, promptHash: r.promptHash })),
  ];
}
