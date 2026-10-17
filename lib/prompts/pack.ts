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
import { FILES, negativeNouns, productFiles, resolveCast, sourcePhotos, usesSourcePhotos, type ResolvedCast } from "./lines";
import { renderShotList } from "./master";
import { getModel, MODEL_IDS, renderLength, type ModelConfig, type ModelId } from "./models.config";
import { estimateTokens, renderScene } from "./veo";

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
  const sceneRefs = (model: ModelConfig, indexes: number[]) => {
    const refs: string[] = [...productRefsFor(model)];
    if (cast === "adult_talent") refs.push(FILES.talentSheet(brief.segment.id));
    for (const index of indexes) {
      const file = FILES.location(brief.segment.id, concept.scenes[index].location);
      if (!refs.includes(file)) refs.push(file);
    }
    return refs;
  };

  const job = (id: string, kind: RenderJob["kind"], model: ModelConfig, indexes: number[], prompt: string, startFrame: StartFrame | null = null): RenderJob => {
    const refs = sceneRefs(model, indexes);
    const trimTo = indexes.reduce((sum, index) => sum + concept.scenes[index].seconds, 0);
    const renderSeconds = renderLength(model, trimTo, { hasRefs: refs.length > 0 && model.supportsImageRefs });
    const negative = negativeNouns(model, "scene");
    return {
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
        ...(startFrame ? { startFrame } : {}),
      }),
    };
  };

  const all = concept.scenes.map((_, index) => index);
  const renders: RenderJob[] = [
    job(`${multiShotModel.template}-${settings.seconds}s`, "multi-shot", multiShotModel, all, renderMultiShot({ model: multiShotModel, product, brief, concept, settings, cast, productRefs: productRefsFor(multiShotModel) })),
  ];
  if (perSceneModel) {
    for (const index of all) {
      renders.push(
        job(`${perSceneModel.template}-scene-${index + 1}`, "scene", perSceneModel, [index], renderScene({ model: perSceneModel, product, brief, concept, settings, cast, sceneIndex: index, productRef: productRefs[0] })),
      );
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

/**
 * Deterministic checks on a finished pack. An empty list means it passes.
 * - every cue the brief carries appears word for word in every render prompt
 * - every render references product_sheet.png, within the model's reference limit
 * - prompts stay under the model's token cap
 * - no guardrail issue (names, minors, ethnicity, likeness, claims) in any prompt
 * - a source photo that shows a person is never a reference
 */
export function checkPack(pack: ProductionPack, brief: BriefSlots, product: ProductSpec, names: readonly string[]): PackProblem[] {
  const problems: PackProblem[] = [];
  const cues = briefCueTexts(brief).filter((cue) => cue.slot !== "talent" || pack.cast === "adult_talent");
  // Case-insensitive and without closing punctuation: a cue that opens a sentence is capitalized,
  // and one placed mid-sentence loses its full stop.
  const normalize = (text: string) => text.trim().replace(/[.!?]+$/, "").toLowerCase();
  const productRef = productFiles(product, pack.settings.direction)[0];

  for (const render of pack.renders) {
    const model = getModel(render.modelId);
    const promptText = render.prompt.toLowerCase();
    for (const cue of cues) {
      if (!promptText.includes(normalize(cue.text))) problems.push({ where: render.id, message: `drops the brief's ${cue.slot} cue` });
    }
    if (!render.refs.includes(productRef) || !render.prompt.includes(productRef)) {
      problems.push({ where: render.id, message: `does not reference ${productRef}` });
    }
    if (model.supportsImageRefs && render.refs.length > model.maxRefs) {
      problems.push({ where: render.id, message: `uses ${render.refs.length} references; the model takes ${model.maxRefs}` });
    }
    if (model.maxPromptTokens !== null && estimateTokens(render.prompt) > model.maxPromptTokens) {
      problems.push({ where: render.id, message: `is about ${estimateTokens(render.prompt)} tokens; the cap is ${model.maxPromptTokens}` });
    }
  }

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
