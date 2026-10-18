// Builds a draft video's RenderPlan on the server, from the report's own pack and never from the
// request: the kept concept's multi-shot prompt in the Seedance template (picked through models.config,
// never by name), the world's storyboard frames and the product image as references, mapped to
// @Image1..N (lib/media/references.ts), at the draft length and price from config.
//
// Where references come from:
//   examples   the founder-approved storyboard and packshot (lib/demo/manifest.ts), served from our
//              own origin under /demo. fal fetches them over the public internet, so they need a public
//              base URL: RENDER_REFS_BASE_URL, else NEXT_PUBLIC_APP_URL, else the production domain on a
//              production deployment. Preview deployments sit behind Vercel's deployment protection,
//              which fal cannot pass, so there the examples need RENDER_REFS_BASE_URL (for example the
//              production origin, whose /demo files are public) or their drafts stay off.
//   live runs  the world's storyboard frames (public storage, already shown on the report), and the
//              brand's own product photo, re-encoded without metadata into private storage and
//              presigned for an hour on each plan (lib/render/photo.ts).
// The render cache key (inputHash) hashes the endpoint, the final prompt, the settings, and each
// reference by what it is: a demo file's sha256, a frame's prompt hash plus model and attempt, or a
// brand photo's source URL plus the re-encoding it went through.
import { CONTROL_SEGMENT, type RenderTarget } from "../api/requests";
import type { ApiError } from "../api/responses";
import type { DemoMedia } from "../demo/manifest";
import { EXAMPLES, type ExampleSlug } from "../demo/examples";
import { hashOf } from "../hash";
import { fitPrompt, mapReferences, type ReferenceImage, type ReferenceRole } from "../media/references";
import type { ProductSpec } from "../prompts/brief";
import { draftUsd, getModel, ROLE_DEFAULTS, VIDEO_MODELS } from "../prompts/models.config";
import type { ProductionPack, RenderJob as PackRenderJob } from "../prompts/pack";
import type { Report } from "../report/schema";
import type { Frame } from "../report/world";
import { renderPlanSchema, type RenderPlan } from "./schema";

type Env = Readonly<Record<string, string | undefined>>;

/** Bumped when the plan's shape or the mapping changes, so older cached drafts are not reused for a new plan. */
export const PLAN_VERSION = 1;
/** How long a plan's presigned references work, and so the plan: one hour. */
export const PLAN_TTL_SECONDS = 60 * 60;
/** renderPlanSchema caps the prompt here. */
export const PROMPT_MAX = 6_000;
/** How brand photos are re-encoded before fal sees them (lib/render/photo.ts), part of their identity. */
export const PHOTO_ENCODING = "webp-q90-max2048-nometa-v1";

/** A refusal with the API's error code, for the routes to answer as is. */
export class RenderError extends Error {
  constructor(
    readonly code: ApiError["error"]["code"],
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RenderError";
  }
}

export type ReferenceSource =
  | { kind: "demo"; role: ReferenceRole; scene: number | null; path: string; sha256: string }
  | { kind: "frame"; role: "frame"; scene: number; url: string; promptHash: string; modelId: string; attempt: 1 | 2 }
  | { kind: "photo"; role: "product"; scene: null; sourceUrl: string };

/** What a draft of one world renders from, before any URL is made. */
export interface RenderSource {
  target: RenderTarget;
  report: "example" | "live";
  pack: ProductionPack;
  /** The pack's multi-shot job in the Seedance template. */
  job: PackRenderJob;
  product: ProductSpec;
  references: ReferenceSource[];
}

/** The example a report id names, if any. */
export function exampleOf(reportId: string): ExampleSlug | null {
  const slug = /^example-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(reportId)?.[1];
  return EXAMPLES.find((e) => e.slug === slug)?.slug ?? null;
}

/** The https origin fal can fetch /demo files from, or null where there is none (see the header). */
export function demoBaseUrl(env: Env = process.env): string | null {
  const origin = (value: string | undefined) => {
    const text = value?.trim();
    if (!text) return null;
    try {
      const url = new URL(text.includes("://") ? text : `https://${text}`);
      return url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  };
  const configured = env.RENDER_REFS_BASE_URL?.trim();
  if (configured) return origin(configured);
  if (env.VERCEL_ENV === "preview") return null;
  return origin(env.NEXT_PUBLIC_APP_URL) ?? (env.VERCEL_ENV === "production" ? origin(env.VERCEL_PROJECT_PRODUCTION_URL) : null);
}

/** The multi-shot job a draft renders: the template family of the default multi-shot model (Seedance), whatever model id the pack's settings picked. */
export function multiShotJob(pack: ProductionPack): PackRenderJob | null {
  const family = getModel(ROLE_DEFAULTS.multiShotVideo).template;
  return pack.renders.find((job) => job.kind === "multi-shot" && getModel(job.modelId).template === family) ?? null;
}

/** One frame per scene: the critique's re-render when there is one, else the first render. */
function bestFrames(frames: readonly Frame[]): Frame[] {
  const byScene = new Map<number, Frame>();
  for (const frame of frames) {
    const held = byScene.get(frame.scene);
    if (!held || frame.attempt > held.attempt) byScene.set(frame.scene, frame);
  }
  return [...byScene.values()].sort((a, b) => a.scene - b.scene);
}

const NO_WORLD = "This report has no world with that id.";

/** An example's founder-approved media (lib/demo/manifest.ts demoMediaFor) and the prompt hashes approved for rendering. */
export interface ExampleMedia {
  demo: DemoMedia;
  approvedPrompts: ReadonlySet<string>;
}

/**
 * What one world (or the Control) of a report renders from. Throws RenderError when the target has
 * no pack, no multi-shot prompt, nothing to use as a reference yet, or (for an example) a prompt the
 * founder has not approved for rendering: examples render approved prompts only, as their demo clips do.
 */
export function renderSource(report: Report, target: RenderTarget, example: ExampleMedia | null): RenderSource {
  if (report.meta.id !== target.reportId) throw new RenderError("not_found", "No report with that id.", 404);
  const isExample = exampleOf(report.meta.id) !== null;
  const product = report.inputs.product;
  let pack: ProductionPack | null;
  let frames: ReferenceSource[] = [];

  if (target.segment === CONTROL_SEGMENT) {
    if (!report.control) throw new RenderError("not_found", NO_WORLD, 404);
    pack = report.control.pack;
  } else {
    const world = report.worlds.find((w) => w.segmentId === target.segment);
    if (!world) throw new RenderError("not_found", NO_WORLD, 404);
    // The pack on show: the latest revision's, else the world's own (as the storyboards pick it).
    const revision = [...world.revisions].reverse().find((r) => r.pack !== null) ?? null;
    pack = revision?.pack ?? world.pack;
    const shown = world.frames;
    if (!isExample && shown && shown.status === "done" && shown.revisionId === (revision?.id ?? null)) {
      frames = bestFrames(shown.frames).map((f) => ({ kind: "frame", role: "frame", scene: f.scene, url: f.url, promptHash: f.promptHash, modelId: f.modelId, attempt: f.attempt }));
    }
  }
  if (!pack) throw new RenderError("invalid", "This world has no Production Pack yet.", 409);
  const job = multiShotJob(pack);
  if (!job) throw new RenderError("invalid", "This world's pack has no multi-shot prompt a draft can render.", 409);
  if (isExample && !example?.approvedPrompts.has(job.promptHash)) throw new RenderError("off", "This example's prompt is not approved for rendering yet.", 409);

  let productRef: ReferenceSource | null = null;
  if (isExample && example) {
    const { demo } = example;
    const board = demo.storyboards[target.segment];
    frames = [...(board?.frames ?? [])].sort((a, b) => a.scene - b.scene).map((f) => ({ kind: "demo", role: "frame", scene: f.scene, path: f.file, sha256: f.sha256 }));
    if (demo.packshot) productRef = { kind: "demo", role: "product", scene: null, path: demo.packshot.file, sha256: demo.packshot.sha256 };
  } else if (!isExample && product.source.kind === "images") {
    const photo = product.source.images.find((image) => !image.showsPerson);
    if (photo) productRef = { kind: "photo", role: "product", scene: null, sourceUrl: photo.url };
  }
  const references = [...(productRef ? [productRef] : []), ...frames].slice(0, VIDEO_MODELS.reference.maxRefs);
  if (references.length === 0) throw new RenderError("invalid", "There is no storyboard or product image to render from yet.", 409);
  return { target, report: isExample ? "example" : "live", pack, job, product, references };
}

/** Whether a source can be planned here: example references need a public base URL, brand photos a private store. */
export function canPlan(source: RenderSource, setup: { demoBase: string | null; privateStorage: boolean }): boolean {
  if (setup.demoBase === null && source.references.some((ref) => ref.kind === "demo")) return false;
  return setup.privateStorage || !source.references.some((ref) => ref.kind === "photo");
}

export interface PlanDeps {
  now: number;
  /** renderLimits().draftSeconds. */
  draftSeconds: number;
  /** demoBaseUrl(): where fal fetches /demo files from. */
  demoBase: string | null;
  /** A presigned URL for a brand photo, re-encoded into private storage (lib/render/photo.ts). */
  photoUrl: (sourceUrl: string) => Promise<string>;
}

const identityOf = (ref: ReferenceSource) => {
  switch (ref.kind) {
    case "demo":
      return { kind: "demo", sha256: ref.sha256 };
    case "frame":
      return { kind: "frame", promptHash: ref.promptHash, modelId: ref.modelId, attempt: ref.attempt };
    case "photo":
      return { kind: "photo", sourceUrl: ref.sourceUrl, encoding: PHOTO_ENCODING };
  }
};

async function urlOf(ref: ReferenceSource, deps: PlanDeps): Promise<string> {
  switch (ref.kind) {
    case "demo":
      if (!deps.demoBase) throw new RenderError("off", "Drafts of the examples are not set up on this deployment.", 503);
      return `${deps.demoBase}${ref.path}`;
    case "frame":
      return ref.url;
    case "photo":
      return deps.photoUrl(ref.sourceUrl);
  }
}

/** The plan fal renders: built from the source alone, references presigned now and good for an hour. */
export async function buildRenderPlan(source: RenderSource, deps: PlanDeps): Promise<RenderPlan> {
  const model = VIDEO_MODELS.reference;
  const urls = await Promise.all(source.references.map((ref) => urlOf(ref, deps)));
  const images: ReferenceImage[] = source.references.map((ref, i) => ({ role: ref.role, scene: ref.scene, url: urls[i] }));
  const mapped = mapReferences(source.job.prompt, images, { productName: source.product.name });
  // renderSource already orders references the way mapReferences numbers them (product, then frames by scene).
  if (mapped.imageUrls.some((url, i) => url !== urls[i])) throw new Error("The references came back in another order than planned.");
  const identities = source.references.map(identityOf);
  const settings = { resolution: "480p", draft: true, aspectRatio: "9:16", generateAudio: true, durationSeconds: deps.draftSeconds } as const;
  const prompt = fitPrompt(mapped.prompt, PROMPT_MAX);
  const inputHash = hashOf({ kind: "draft-video", version: PLAN_VERSION, endpoint: model.endpoint, prompt, ...settings, references: identities });
  const parsed = renderPlanSchema.safeParse({
    target: source.target,
    endpoint: model.endpoint,
    prompt,
    imageUrls: mapped.imageUrls,
    ...settings,
    inputHash,
    estimatedUsd: draftUsd(model, settings.durationSeconds),
    expiresAt: new Date(deps.now + PLAN_TTL_SECONDS * 1000).toISOString(),
  });
  if (!parsed.success) throw new RenderError("invalid", `This world's draft cannot be planned: ${parsed.error.issues[0]?.message ?? "invalid plan"}.`, 422);
  return parsed.data;
}
