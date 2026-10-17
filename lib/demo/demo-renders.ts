// What scripts/render-demo.ts renders on fal for the examples, offline and only by the founder: one
// packshot per example and up to 4 storyboard frames per world (and the Control), each from an exact
// prompt with its own hash. Pure planning, no I/O: lib/demo/render-demo.ts runs the plans.
//
//   packshot     the report pack's packshot.png asset prompt (a text description of a fictional product,
//                no people, no logos but the product's own), text to image, square. Its hash covers the
//                endpoint, the size, the prompt and the asset's own pack hash.
//   storyboards  the live frame template (lib/prompts/frames.ts) on the world's pack. With an approved
//                packshot, the edit model takes it as the reference image and the hash pins that exact
//                file (its sha256); without one, the text model renders from the product description.
// The reports' products stay text-only (inputs.product is never changed): the packshot is a reference
// override at render time, recorded in the manifest.
import { hashOf } from "../hash";
import { checkText, FAMOUS_PLACES } from "../guardrails";
import type { BriefSlots, ProductSpec } from "../prompts/brief";
import { frameBody, frameClosing, framePromptHash, frameScenes, FRAMES_PER_WORLD } from "../prompts/frames";
import { FRAME_MODELS, type FrameModel } from "../prompts/models.config";
import { packHashes, type PackAsset } from "../prompts/pack";
import type { Report } from "../report/schema";
import { claudeUsd } from "../runtime/cost";
import { MAX_REWRITES } from "../stages/critique";
import type { DemoPackshot } from "./manifest";
import { reportPacks, type ReportPack } from "./report-packs";

/** Bump when the demo packshot wording or settings change: earlier approvals then stop matching. */
export const DEMO_RENDER_VERSION = 1;
/** fal FLUX [schnell]'s square preset (1024 x 1024, one megapixel). */
export const PACKSHOT_IMAGE_SIZE = "square_hd";
export const PACKSHOT_MODEL: FrameModel = FRAME_MODELS.text;
/**
 * The most images one render-demo invocation may request from fal, re-renders included: 3 storyboards
 * of 4 frames, each frame re-rendered once at most.
 */
export const MAX_IMAGES_PER_INVOCATION = 24;
/** Claude's frame review, per storyboard: 4 images and the brief in, the review out (list prices, an estimate). */
export const CRITIQUE_TOKENS_ESTIMATE = { inputTokens: 12_000, outputTokens: 5_000, cachedInputTokens: 0 } as const;
export const CRITIQUE_USD_ESTIMATE = claudeUsd(CRITIQUE_TOKENS_ESTIMATE);

export const demoDir = (slug: string) => `/demo/${slug}`;
export const packshotPath = (slug: string) => `${demoDir(slug)}/packshot.webp`;
export const framePath = (slug: string, key: string, scene: number) => `${demoDir(slug)}/frames/${key}-shot-${scene + 1}.webp`;

// --- The packshot ----------------------------------------------------------------------------------

export interface PackshotPlan {
  slug: string;
  /** The report pack's packshot.png asset (shared by every pack of the product). */
  asset: PackAsset;
  model: FrameModel;
  imageSize: typeof PACKSHOT_IMAGE_SIZE;
  prompt: string;
  promptHash: string;
  /** Served path, e.g. /demo/food-hot-sauce/packshot.webp. */
  file: string;
  usd: number;
}

export function packshotHash(model: FrameModel, prompt: string, assetHash: string): string {
  return hashOf({ kind: "demo-packshot", version: DEMO_RENDER_VERSION, endpoint: model.endpoint, imageSize: PACKSHOT_IMAGE_SIZE, prompt, assetHash });
}

/** The packshot every pack of the report shares. Throws when the packs disagree or the product has photos instead. */
export function packshotPlan(report: Report): PackshotPlan {
  const slug = report.inputs.product.slug;
  if (report.inputs.product.source.kind !== "description") throw new Error(`${slug} is known from its own photos; a demo packshot is only rendered for a product described in text.`);
  const assets = reportPacks(report).map((p) => p.pack.assets.find((a) => a.kind === "packshot") ?? null);
  const asset = assets[0];
  if (!asset || assets.some((a) => a?.promptHash !== asset.promptHash)) throw new Error(`${slug}: the packs do not share one packshot asset.`);
  const prompt = asset.prompt;
  return { slug, asset, model: PACKSHOT_MODEL, imageSize: PACKSHOT_IMAGE_SIZE, prompt, promptHash: packshotHash(PACKSHOT_MODEL, prompt, asset.promptHash), file: packshotPath(slug), usd: PACKSHOT_MODEL.usdPerFrame };
}

// --- Storyboards -----------------------------------------------------------------------------------

export interface FramePlan {
  scene: number;
  model: FrameModel;
  /** What the frame shows; a critique rewrite replaces it. */
  body: string;
  /** The rules code adds to every frame prompt, rewritten or not. */
  closing: string;
  prompt: string;
  /** What the hash pins as the reference: the packshot's served path and sha256. Empty for the text model. */
  referenceIds: string[];
  promptHash: string;
}

export interface BoardPlan {
  slug: string;
  entry: ReportPack;
  /** The approved packshot the edit model references, or null (text only). */
  reference: DemoPackshot | null;
  frames: FramePlan[];
  /** Frames whose prompt breaks the guardrails: never rendered. */
  blocked: { scene: number; message: string }[];
}

export const referenceId = (packshot: Pick<DemoPackshot, "file" | "sha256">) => `${packshot.file}#sha256=${packshot.sha256}`;

function framePlan(scene: number, body: string, closing: string, reference: DemoPackshot | null): FramePlan {
  const model = reference ? FRAME_MODELS.edit : FRAME_MODELS.text;
  const referenceIds = reference ? [referenceId(reference)] : [];
  const prompt = `${body.trim()}\n\n${closing}`;
  return { scene, model, body: body.trim(), closing, prompt, referenceIds, promptHash: framePromptHash(model, prompt, referenceIds) };
}

export const frameGuard = (text: string, names: readonly string[], brief: BriefSlots, product: ProductSpec) =>
  checkText(text, { names: [...names, ...FAMOUS_PLACES], allowedNames: [...brief.allowedPlaces, ...(product.brandName ? [product.brandName] : [])], exactCaseNames: true });

/** A world's (or the Control's) frames: the live frame template, with the packshot as the reference when one is approved. */
export function storyboardPlan(report: Report, entry: ReportPack, reference: DemoPackshot | null, names: readonly string[]): BoardPlan {
  const product = report.inputs.product;
  const input = (sceneIndex: number) => ({ pack: entry.pack, brief: entry.brief, product, sceneIndex });
  const planned = frameScenes(entry.pack.concept.scenes, FRAMES_PER_WORLD).map((scene) => framePlan(scene, frameBody(input(scene)), frameClosing(input(scene), reference !== null), reference));
  const blocked: BoardPlan["blocked"] = [];
  const frames = planned.filter((plan) => {
    const issues = frameGuard(plan.prompt, names, entry.brief, product);
    if (issues.length > 0) blocked.push({ scene: plan.scene, message: issues[0].message });
    return issues.length === 0;
  });
  return { slug: product.slug, entry, reference, frames, blocked };
}

/** The re-render after a critique: the rewritten body with the same closing, model and reference. */
export function rewritePlan(plan: FramePlan, rewrite: string, reference: DemoPackshot | null): FramePlan {
  return framePlan(plan.scene, rewrite, plan.closing, reference);
}

/** The boards a storyboards command renders: one world, the Control, or all of them (Control first). */
export function selectBoards(report: Report, select: { segment?: string | null; control?: boolean }): ReportPack[] {
  const all = reportPacks(report);
  if (select.segment && select.control) throw new Error("Pass --segment <id> or --control, not both.");
  if (select.control) return all.filter((p) => p.segmentId === null);
  if (select.segment) {
    const found = all.filter((p) => p.segmentId === select.segment);
    if (found.length === 0) throw new Error(`${report.inputs.product.slug} has no world "${select.segment}". Worlds: ${report.worlds.map((w) => w.segmentId).join(", ")}.`);
    return found;
  }
  return all;
}

export interface BoardCost {
  firstRenders: number;
  /** Re-renders at most: one per flagged frame, up to MAX_REWRITES. */
  maxRerenders: number;
  /** Dollars: first renders, worst-case re-renders, and the Claude review. */
  usd: { renders: number; rerenders: number; critique: number; total: number };
}

export function boardCost(plan: BoardPlan): BoardCost {
  const firstRenders = plan.frames.length;
  const maxRerenders = Math.min(firstRenders, MAX_REWRITES);
  const perFrame = plan.frames[0]?.model.usdPerFrame ?? 0;
  const renders = firstRenders * perFrame;
  const rerenders = maxRerenders * perFrame;
  const critique = firstRenders > 0 ? CRITIQUE_USD_ESTIMATE : 0;
  return { firstRenders, maxRerenders, usd: { renders, rerenders, critique, total: renders + rerenders + critique } };
}

/** "$0.32"; amounts under a cent keep three decimals ("$0.003"). */
export const usd = (amount: number) => (amount > 0 && amount < 0.01 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`);

/** Every hash the founder approves for the export: each pack's asset and render hashes, then the demo packshot. */
export function exportHashes(report: Report): { id: string; promptHash: string }[] {
  const seen = new Set<string>();
  const out: { id: string; promptHash: string }[] = [];
  const add = (h: { id: string; promptHash: string }) => {
    if (seen.has(h.promptHash)) return;
    seen.add(h.promptHash);
    out.push(h);
  };
  for (const entry of reportPacks(report)) packHashes(entry.pack).forEach(add);
  const packshot = packshotPlan(report);
  add({ id: `${packshot.slug}/demo/packshot.webp (${packshot.model.endpoint})`, promptHash: packshot.promptHash });
  return out;
}
