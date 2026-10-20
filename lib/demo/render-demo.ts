// The commands behind scripts/render-demo.ts: the examples' demo media, made offline by the founder.
//   packshot     one product image per example on fal, from the report pack's packshot asset prompt
//   storyboards  up to 4 frames per world (or the Control) on fal, then Claude's critique. A rewrite is
//                only recorded (exports/<slug>/pending-rewrites.json, gitignored) and printed for approval
//   rerender     renders the rewrites whose hashes are now approved, one per scene, as attempt 2
//   clip         registers a clip the founder rendered in Higgsfield from an approved pack prompt
//   approveList  what is in the manifest (or pending) but not approved yet, as lines for approvals.json
// Spend rules: nothing renders a prompt hash that is not in public/demo/approvals.json; every command
// prints the prompts, hashes, model and estimated cost first, renders nothing without --yes (and nothing
// at all on --dry-run), stops at MAX_IMAGES_PER_INVOCATION images, and never renders over an approved
// file without --replace. A frame Claude marks unsafe is never written. fal's bytes are written exactly
// as they come (no re-encoding, so provenance marks survive) after checking they are an image of the
// requested type under MAX_DEMO_IMAGE_BYTES. Media goes under public/demo/<slug>/ only, the manifest is
// validated before every write, and approvals.json is never written: the founder edits it by hand.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFalClient, type FalClient } from "@fal-ai/client";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createFalRenderer, type FrameRenderer, type RenderedImage } from "../media/frames";
import { FRAME_MODELS } from "../prompts/models.config";
import type { FrameCritique } from "../report/world";
import { reportNames } from "../stages/after-run";
import { critiqueFrames, frameChecklist, type CritiqueResult } from "../stages/critique";
import {
  boardCost,
  CONTENT_TYPES,
  EXTENSIONS,
  framePath,
  frameGuard,
  IMAGE_FORMATS,
  MAX_IMAGES_PER_INVOCATION,
  outputFormat,
  PACKSHOT_IMAGE_SIZE,
  packshotPlan,
  rewritePlan,
  selectBoards,
  sizeLabel,
  storyboardPlan,
  usd,
  type BoardPlan,
  type FramePlan,
  type ImageFormat,
} from "./demo-renders";
import type { ExampleSlug } from "./examples";
import { CONTROL_SEGMENT } from "../api/requests";
import { approvalsSchema, demoMediaFor, manifestSchema, type DemoApprovals, type DemoClip, type DemoFrame, type DemoManifest, type DemoPackshot, type DemoStoryboard } from "./manifest";
import { NOT_APPROVED } from "./report-export";
import { isExampleSlug, loadExampleReport, reportPacks } from "./report-packs";

export class DemoRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoRefusal";
  }
}

export interface DemoRenderers {
  /** Text to image at the packshot's square size, as JPEG. */
  packshot: FrameRenderer;
  /** The storyboard renderer (the live frame adapter), asking for compact formats. */
  frame: FrameRenderer;
}

export interface DemoDeps {
  /** The repository root: reads data/runs and public/demo, writes public/demo/<slug>/, the manifest and exports/<slug>/. */
  root: string;
  /** fal, or null where nothing may render (dry runs, a missing key). */
  renderers: DemoRenderers | null;
  /** Claude for the storyboard critique, or null. */
  model: LanguageModel | null;
  log: (line: string) => void;
  /** Images one invocation may request; never above MAX_IMAGES_PER_INVOCATION. */
  maxImages?: number;
}

export interface SpendFlags {
  dryRun: boolean;
  yes: boolean;
  /** Render over files the founder already approved (they then need a new approval). */
  replace?: boolean;
}

// --- Files --------------------------------------------------------------------------------------------

export const manifestFile = (root: string) => path.join(root, "public", "demo", "manifest.json");
export const approvalsFile = (root: string) => path.join(root, "public", "demo", "approvals.json");
/** Critique rewrites waiting for approval: a review file (exports/ is gitignored), never the manifest. */
export const pendingFile = (root: string, slug: string) => path.join(root, "exports", slug, "pending-rewrites.json");

export async function readManifest(root: string): Promise<DemoManifest> {
  return manifestSchema.parse(JSON.parse(await readFile(manifestFile(root), "utf8")));
}

export async function readApprovals(root: string): Promise<DemoApprovals> {
  return approvalsSchema.parse(JSON.parse(await readFile(approvalsFile(root), "utf8")));
}

async function writeManifest(root: string, manifest: DemoManifest): Promise<void> {
  const valid = manifestSchema.parse(manifest);
  await writeFile(manifestFile(root), `${JSON.stringify(valid, null, 2)}\n`);
}

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The disk path of a served /demo/<slug>/... file, refusing anything outside public/demo/<slug>/. */
export function demoFile(root: string, slug: string, served: string): string {
  const base = path.resolve(root, "public", "demo", slug);
  const file = path.resolve(root, "public", `.${served}`);
  if (!served.startsWith(`/demo/${slug}/`) || !file.startsWith(`${base}${path.sep}`)) throw new DemoRefusal(`Refusing ${served}: demo media for ${slug} lives under public/demo/${slug}/ only.`);
  return file;
}

async function writeDemoFile(root: string, slug: string, served: string, bytes: Uint8Array): Promise<void> {
  const file = demoFile(root, slug, served);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

const removeDemoFile = (root: string, slug: string, served: string) => rm(demoFile(root, slug, served), { force: true });

const dataUri = (bytes: Uint8Array, contentType: string) => `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;

// --- Images -------------------------------------------------------------------------------------------

/** What a demo image may weigh: fal's 1K frames are well under it. */
export const MAX_DEMO_IMAGE_BYTES = 10 * 1024 * 1024;

/** The image format by its first bytes, or null. */
export function imageFormatOf(bytes: Uint8Array): ImageFormat | null {
  const ascii = (from: number, to: number) => Buffer.from(bytes.subarray(from, to)).toString("latin1");
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return "png";
  return null;
}

export class DemoImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoImageError";
  }
}

/** fal's bytes, unmodified, once they are an image of the requested type under the size cap. */
export function checkedImage(image: RenderedImage, expected: ImageFormat): Uint8Array {
  const size = image.bytes.byteLength;
  if (size === 0 || size > MAX_DEMO_IMAGE_BYTES) throw new DemoImageError(`The image is ${size} bytes; a demo image is between 1 byte and ${MAX_DEMO_IMAGE_BYTES} bytes.`);
  const format = imageFormatOf(image.bytes);
  if (format !== expected || image.contentType !== CONTENT_TYPES[expected]) {
    throw new DemoImageError(`Asked fal for ${expected}, got ${image.contentType} (${format ?? "not an image"} by its bytes); nothing written.`);
  }
  return image.bytes;
}

// --- fal ----------------------------------------------------------------------------------------------

type Subscriber = Pick<FalClient, "subscribe">;

/** A fal client that adds input fields per endpoint before every request (the live adapter's input stays as it is). */
function withInput(client: Subscriber, extra: (endpoint: string) => Record<string, unknown>): Subscriber {
  return {
    subscribe: (endpoint: string, run: { input?: Record<string, unknown> }) => client.subscribe(endpoint, { ...run, input: { ...run.input, ...extra(endpoint) } }),
  } as unknown as Subscriber;
}

const formatFor = (endpoint: string) => outputFormat(Object.values(FRAME_MODELS).find((m) => m.endpoint === endpoint) ?? FRAME_MODELS.text);

/** The live frame adapter at fal's square preset, as JPEG (the packshot asset is 1:1). */
export function packshotFalRenderer(options: { credentials: string; client?: Subscriber; fetch?: typeof fetch }): FrameRenderer {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  return createFalRenderer({ credentials: options.credentials, client: withInput(client, (endpoint) => ({ image_size: PACKSHOT_IMAGE_SIZE, output_format: formatFor(endpoint) })), ...(options.fetch ? { fetch: options.fetch } : {}) });
}

/** The live frame adapter asking for compact formats: WebP from the edit model, JPEG from FLUX [schnell]. */
export function frameFalRenderer(options: { credentials: string; client?: Subscriber; fetch?: typeof fetch }): FrameRenderer {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  return createFalRenderer({ credentials: options.credentials, client: withInput(client, (endpoint) => ({ output_format: formatFor(endpoint) })), ...(options.fetch ? { fetch: options.fetch } : {}) });
}

export function falRenderers(credentials: string): DemoRenderers {
  return { packshot: packshotFalRenderer({ credentials }), frame: frameFalRenderer({ credentials }) };
}

/** Counts every image requested from the vendor and refuses past the invocation's cap. */
export function cappedRenderer(renderer: FrameRenderer, budget: { used: number; max: number }): FrameRenderer {
  return {
    render: async (request, options) => {
      if (budget.used >= budget.max) throw new DemoRefusal(`Stopped at the cap of ${budget.max} images per invocation.`);
      budget.used++;
      return renderer.render(request, options);
    },
  };
}

function capOf(deps: DemoDeps): number {
  return Math.min(deps.maxImages ?? MAX_IMAGES_PER_INVOCATION, MAX_IMAGES_PER_INVOCATION);
}

function exampleSlug(slug: string): ExampleSlug {
  if (!isExampleSlug(slug)) throw new DemoRefusal(`"${slug}" is not an example.`);
  return slug;
}

const approvedLines = (label: string, hashes: readonly string[]) => (hashes.length ? [`Add to approvals.json "${label}":`, ...hashes.map((h) => `  "${h}",`)] : []);

/** Refuses to overwrite an approved file unless --replace: a worse render must never destroy the approved one. */
function guardApproved(files: readonly { file: string; sha256: string }[], approvals: DemoApprovals, replace: boolean | undefined, log: (line: string) => void, dryRun: boolean): void {
  const approved = files.filter((f) => approvals.files.includes(f.sha256));
  if (approved.length === 0) return;
  const list = approved.map((f) => f.file).join(", ");
  if (dryRun || replace) {
    log(`  replaces approved file(s): ${list}${replace ? "" : " (pass --replace to render over them)"}`);
    return;
  }
  throw new DemoRefusal(`Refusing to render over approved file(s): ${list}. Pass --replace to do it anyway; the new files then need a new approval.`);
}

// --- packshot -----------------------------------------------------------------------------------------

export interface CommandResult {
  status: "dry-run" | "done";
  /** Served paths written. */
  written: string[];
}

export async function packshotCommand(deps: DemoDeps, slugArg: string, flags: SpendFlags): Promise<CommandResult> {
  const slug = exampleSlug(slugArg);
  const { log } = deps;
  const report = loadExampleReport(slug, deps.root);
  const plan = packshotPlan(report);
  const approvals = await readApprovals(deps.root);
  const approved = approvals.prompts.includes(plan.promptHash);
  log(`${slug}: packshot from the packs' ${plan.asset.file} asset (pack hash ${plan.asset.promptHash})`);
  log(`  model ${plan.model.displayName} (${plan.model.endpoint}), ${sizeLabel(plan.imageSize)}, ${plan.format}, text to image, no reference`);
  log(`  promptHash ${plan.promptHash} (${approved ? "approved" : "NOT approved"})`);
  log(`  writes ${plan.file}`);
  log(`  prompt: ${plan.prompt}`);
  log(`  estimated cost: ${usd(plan.usd)} (1 image)`);
  const existing = (await readManifest(deps.root)).packshots.filter((p) => p.example === slug);
  guardApproved(existing, approvals, flags.replace, log, flags.dryRun);
  if (flags.dryRun) return { status: "dry-run", written: [] };
  if (!approved) throw new DemoRefusal(`The packshot prompt is not approved. After reading it, add to approvals.json "prompts":\n  "${plan.promptHash}",`);
  if (!flags.yes) throw new DemoRefusal(`Nothing rendered: add --yes to spend about ${usd(plan.usd)}.`);
  if (capOf(deps) < 1) throw new DemoRefusal(`The cap of ${capOf(deps)} images per invocation leaves no room for the packshot.`);
  if (!deps.renderers) throw new DemoRefusal("No fal renderer: set FAL_KEY in your local env file.");

  const renderer = cappedRenderer(deps.renderers.packshot, { used: 0, max: capOf(deps) });
  const bytes = checkedImage(await renderer.render({ model: plan.model, prompt: plan.prompt, referenceUrls: [] }), plan.format);
  const entry: DemoPackshot = { example: slug, file: plan.file, promptHash: plan.promptHash, sha256: sha256Of(bytes), modelId: plan.model.endpoint };
  const manifest = await readManifest(deps.root);
  // The manifest is validated before any file lands, so a schema failure leaves no orphan.
  const next = manifestSchema.parse({ ...manifest, packshots: [...manifest.packshots.filter((p) => p.example !== slug), entry] });
  await writeDemoFile(deps.root, slug, plan.file, bytes);
  for (const old of existing) if (old.file !== entry.file) await removeDemoFile(deps.root, slug, old.file);
  await writeManifest(deps.root, next);
  log(`${slug}: wrote ${entry.file} (sha256 ${entry.sha256}). View it, then approve the file:`);
  for (const line of approvedLines("files", [entry.sha256])) log(line);
  return { status: "done", written: [entry.file] };
}

// --- pending rewrites ---------------------------------------------------------------------------------

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

const pendingRewriteSchema = z.strictObject({
  /** Null for the Control. */
  segmentId: z.string().min(1).nullable(),
  scene: z.number().int().min(0),
  issues: z.array(z.string()),
  /** The rewritten frame description (the prompt is this plus the closing code adds). */
  body: z.string().min(1),
  prompt: z.string().min(1),
  promptHash: hex64,
  modelId: z.string().min(1),
  referenceIds: z.array(z.string()),
  /** The board's frame it replaces, or null when the scene was left out (marked unsafe). */
  replaces: z.strictObject({ promptHash: hex64, sha256: hex64 }).nullable(),
});
export type PendingRewrite = z.infer<typeof pendingRewriteSchema>;

const pendingFileSchema = z.strictObject({
  status: z.literal(NOT_APPROVED),
  note: z.string(),
  example: z.string(),
  rewrites: z.array(pendingRewriteSchema),
});

export async function readPending(root: string, slug: string): Promise<PendingRewrite[]> {
  const file = pendingFile(root, slug);
  if (!existsSync(file)) return [];
  const parsed = pendingFileSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success || parsed.data.example !== slug) throw new DemoRefusal(`${path.relative(root, file)} is not a pending-rewrites file for ${slug}; render the storyboards again to rebuild it.`);
  return parsed.data.rewrites;
}

async function writePending(root: string, slug: string, rewrites: readonly PendingRewrite[]): Promise<void> {
  const file = pendingFile(root, slug);
  await mkdir(path.dirname(file), { recursive: true });
  const body = {
    status: NOT_APPROVED,
    note: `Critique rewrites, not rendered. Read each prompt; approve the ones you want by adding their promptHash to public/demo/approvals.json "prompts", then run npm run render:demo -- storyboards ${slug} --rerender --yes.`,
    example: slug,
    rewrites: [...rewrites].sort((a, b) => (a.segmentId ?? "").localeCompare(b.segmentId ?? "") || a.scene - b.scene),
  };
  await writeFile(file, `${JSON.stringify(pendingFileSchema.parse(body), null, 2)}\n`);
}

// --- storyboards (first pass) ------------------------------------------------------------------------

export interface StoryboardSelect {
  segment?: string | null;
  control?: boolean;
}

/** The approved packshot as fal's reference (a data URI of the exact file), refusing a file that changed since it was approved. */
async function referenceUri(deps: DemoDeps, slug: string, packshot: DemoPackshot): Promise<string> {
  const file = demoFile(deps.root, slug, packshot.file);
  if (!existsSync(file)) throw new DemoRefusal(`The approved packshot ${packshot.file} is missing.`);
  const bytes = new Uint8Array(await readFile(file));
  if (sha256Of(bytes) !== packshot.sha256) throw new DemoRefusal(`${packshot.file} changed since it was approved (sha256 differs); render and approve it again.`);
  const format = imageFormatOf(bytes);
  if (!format) throw new DemoRefusal(`${packshot.file} is not a WebP, JPEG or PNG image.`);
  return dataUri(bytes, CONTENT_TYPES[format]);
}

function logBoard(log: (line: string) => void, plan: BoardPlan, approved: ReadonlySet<string>): void {
  const { entry } = plan;
  const cost = boardCost(plan);
  const model = plan.frames[0]?.model;
  log(`${plan.slug}/${entry.key}: ${entry.segmentId === null ? "the Control" : `world "${entry.label}"`}, concept "${entry.pack.concept.title}"`);
  log(`  model ${model?.displayName ?? "-"} (${model?.endpoint ?? "-"}, ${model ? outputFormat(model) : "-"}), ${plan.reference ? `reference ${plan.reference.file} (sha256 ${plan.reference.sha256})` : "text only (no approved packshot)"}`);
  for (const frame of plan.frames) {
    const scene = entry.pack.concept.scenes[frame.scene];
    log(`  shot ${frame.scene + 1} (${scene?.beat ?? "scene"}): promptHash ${frame.promptHash} (${approved.has(frame.promptHash) ? "approved" : "NOT approved"})`);
    log(`    ${frame.prompt.replace(/\n+/g, " ")}`);
  }
  for (const b of plan.blocked) log(`  shot ${b.scene + 1}: left out, its prompt breaks the guardrails: ${b.message}`);
  log(
    `  estimated cost: ${usd(cost.usd.renders)} for ${cost.firstRenders} frames and about ${usd(cost.usd.critique)} for Claude's review now; later, up to ${usd(cost.usd.rerenders)} for ${cost.maxRerenders} approved rewrites (--rerender); both steps at most ${usd(cost.usd.total)}`,
  );
}

/** The fairness rule: an example's boards all render on one model with one reference, so only the brief differs. */
function mismatchedBoards(manifest: DemoManifest, report: ReturnType<typeof loadExampleReport>, slug: string, boards: readonly BoardPlan[], reference: DemoPackshot | null, names: readonly string[]): string[] {
  const selected = new Set(boards.map((b) => b.entry.segmentId));
  const endpoint = boards[0]?.frames[0]?.model.endpoint;
  const entries = reportPacks(report);
  return manifest.storyboards
    .filter((s) => s.example === slug && !selected.has(s.segmentId))
    .filter((s) => {
      const entry = entries.find((e) => e.segmentId === s.segmentId);
      const expected = new Set(entry ? storyboardPlan(report, entry, reference, names).frames.map((f) => f.promptHash) : []);
      return s.frames.some((f) => f.modelId !== endpoint || (f.attempt === 1 && !expected.has(f.promptHash)));
    })
    .map((s) => s.segmentId ?? CONTROL_SEGMENT);
}

export async function storyboardsCommand(deps: DemoDeps, slugArg: string, select: StoryboardSelect, flags: SpendFlags): Promise<CommandResult> {
  const slug = exampleSlug(slugArg);
  const { log } = deps;
  const report = loadExampleReport(slug, deps.root);
  const manifest = await readManifest(deps.root);
  const approvals = await readApprovals(deps.root);
  const approved = new Set(approvals.prompts);
  const reference = demoMediaFor(manifest, approvals, slug).packshot;
  if (!reference && manifest.packshots.some((p) => p.example === slug)) log(`${slug}: the packshot in the manifest is not approved (prompt and file), so these frames render text only.`);
  const names = reportNames(report);
  let boards: BoardPlan[];
  try {
    boards = selectBoards(report, select).map((entry) => storyboardPlan(report, entry, reference, names));
  } catch (error) {
    throw new DemoRefusal(error instanceof Error ? error.message : String(error));
  }
  for (const board of boards) logBoard(log, board, approved);
  const images = boards.reduce((sum, b) => sum + boardCost(b).firstRenders, 0);
  const now = boards.reduce((sum, b) => sum + boardCost(b).usd.pass, 0);
  const total = boards.reduce((sum, b) => sum + boardCost(b).usd.total, 0);
  log(`${slug}: ${boards.length} storyboard${boards.length === 1 ? "" : "s"}, ${images} images now (${usd(now)} with the review), at most ${usd(total)} with every rewrite approved and re-rendered.`);

  const mismatched = mismatchedBoards(manifest, report, slug, boards, reference, names);
  const together = `Every storyboard of an example renders on one model with one reference (only the brief differs): render them together with \`storyboards ${slug}\` (no --segment or --control).`;
  if (mismatched.length > 0 && flags.dryRun) log(`  the ${mismatched.join(", ")} storyboard(s) were rendered with another model or packshot. ${together}`);
  const selected = new Set(boards.map((b) => b.entry.segmentId));
  guardApproved(
    manifest.storyboards.filter((s) => s.example === slug && selected.has(s.segmentId)).flatMap((s) => s.frames),
    approvals,
    flags.replace,
    log,
    flags.dryRun,
  );
  if (flags.dryRun) return { status: "dry-run", written: [] };
  if (mismatched.length > 0) throw new DemoRefusal(`The ${mismatched.join(", ")} storyboard(s) were rendered with another model or packshot than these would be. ${together}`);

  const blocked = boards.flatMap((b) => b.blocked.map((x) => `${b.entry.key} shot ${x.scene + 1}`));
  if (blocked.length > 0) throw new DemoRefusal(`Frame prompts break the guardrails (${blocked.join(", ")}); nothing rendered.`);
  const unapproved = [...new Set(boards.flatMap((b) => b.frames.map((f) => f.promptHash)).filter((h) => !approved.has(h)))];
  if (unapproved.length > 0) throw new DemoRefusal([`${unapproved.length} frame prompt(s) are not approved; nothing rendered. After reading them, add to approvals.json "prompts":`, ...unapproved.map((h) => `  "${h}",`)].join("\n"));
  if (!flags.yes) throw new DemoRefusal(`Nothing rendered: add --yes to spend about ${usd(now)}.`);
  const cap = capOf(deps);
  if (images > cap) throw new DemoRefusal(`These storyboards take ${images} images; one invocation renders at most ${cap}. Pass --segment <id> or --control.`);
  if (!deps.renderers) throw new DemoRefusal("No fal renderer: set FAL_KEY in your local env file.");
  if (!deps.model) throw new DemoRefusal("No Claude model for the frame review: set ANTHROPIC_API_KEY in your local env file.");

  const budget = { used: 0, max: cap };
  const renderer = cappedRenderer(deps.renderers.frame, budget);
  const refUrls = reference ? [await referenceUri(deps, slug, reference)] : [];
  const written: string[] = [];
  for (const board of boards) {
    const outcome = await renderBoard({ deps, slug, report, names, renderer, refUrls, board });
    if (!outcome) continue;
    const label = `${slug}/${board.entry.key}`;
    // Each storyboard lands as soon as it is done, so a later failure keeps it. Only a scene with a new
    // reviewed, safe frame changes: every other scene keeps its earlier frame and file (a partial fal
    // failure or an unsafe render never deletes one), with its earlier critique.
    const current = await readManifest(deps.root);
    const old = current.storyboards.find((s) => s.example === slug && s.segmentId === board.entry.segmentId);
    const landed = new Set(outcome.landed.map((l) => l.frame.scene));
    const kept = (old?.frames ?? []).filter((f) => !landed.has(f.scene));
    const planned = new Map(board.frames.map((f) => [f.scene, f]));
    for (const f of kept) {
      if (f.modelId !== planned.get(f.scene)?.model.endpoint || (f.attempt === 1 && f.promptHash !== planned.get(f.scene)?.promptHash)) {
        log(`${label} shot ${f.scene + 1}: keeps its earlier frame, made with another model or packshot; render this storyboard again for a consistent board.`);
      }
    }
    const frames = [...kept, ...outcome.landed.map((l) => l.frame)].sort((a, b) => a.scene - b.scene);
    const critiques = [...(old?.critiques ?? []).filter((c) => !landed.has(c.scene)), ...outcome.critiques.filter((c) => landed.has(c.scene))].sort((a, b) => a.scene - b.scene);
    const others = current.storyboards.filter((s) => s !== old);
    const next = manifestSchema.parse({ ...current, storyboards: frames.length ? [...others, { example: slug, segmentId: board.entry.segmentId, frames, critiques }] : others });
    // Files land only after the manifest that lists them is valid.
    for (const { frame, bytes } of outcome.landed) await writeDemoFile(deps.root, slug, frame.file, bytes);
    for (const f of old?.frames ?? []) {
      const replacement = outcome.landed.find((l) => l.frame.scene === f.scene);
      if (replacement && replacement.frame.file !== f.file) await removeDemoFile(deps.root, slug, f.file);
    }
    await writeManifest(deps.root, next);
    // A reviewed scene's earlier rewrite is superseded; an unreviewed scene's stays.
    const byScene = new Map(frames.map((f) => [f.scene, f]));
    const rewrites: PendingRewrite[] = outcome.rewrites.map((r) => {
      const frame = byScene.get(r.scene);
      return { ...r, replaces: frame ? { promptHash: frame.promptHash, sha256: frame.sha256 } : null };
    });
    const pending = (await readPending(deps.root, slug)).filter((p) => p.segmentId !== board.entry.segmentId || !outcome.reviewed.has(p.scene));
    await writePending(deps.root, slug, [...pending, ...rewrites]);
    written.push(...outcome.landed.map((l) => l.frame.file));
    for (const r of rewrites) {
      log(`${label} shot ${r.scene + 1}: rewrite pending approval, promptHash ${r.promptHash}`);
      log(`    ${r.prompt.replace(/\n+/g, " ")}`);
    }
  }
  log(`${slug}: ${budget.used} images rendered, ${written.length} frames kept.`);
  for (const line of await approveList(deps, slug)) log(line);
  return { status: "done", written };
}

interface BoardContext {
  deps: DemoDeps;
  slug: ExampleSlug;
  report: ReturnType<typeof loadExampleReport>;
  names: readonly string[];
  renderer: FrameRenderer;
  refUrls: string[];
  board: BoardPlan;
}

interface Rendered {
  plan: FramePlan;
  bytes: Uint8Array;
  format: ImageFormat;
}

/** Renders plans in parallel; a failed or wrong-typed image is logged and left out. The invocation cap still stops everything. */
async function renderPlans(renderer: FrameRenderer, plans: readonly FramePlan[], refUrls: readonly string[], onFail: (plan: FramePlan, message: string) => void): Promise<Rendered[]> {
  const settled = await Promise.allSettled(
    plans.map(async (plan) => {
      const format = outputFormat(plan.model);
      const bytes = checkedImage(await renderer.render({ model: plan.model, prompt: plan.prompt, referenceUrls: refUrls }), format);
      return { plan, bytes, format } satisfies Rendered;
    }),
  );
  const refusal = settled.find((s): s is PromiseRejectedResult => s.status === "rejected" && s.reason instanceof DemoRefusal);
  if (refusal) throw refusal.reason;
  settled.forEach((s, i) => {
    if (s.status === "rejected") onFail(plans[i], s.reason instanceof Error ? s.reason.message : String(s.reason));
  });
  return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

interface BoardOutcome {
  /** New frames to save: rendered, reviewed and not marked unsafe (attempt 1). */
  landed: { frame: DemoFrame; bytes: Uint8Array }[];
  /** The review of the landed frames, with no rewrite (nothing re-rendered in this pass). */
  critiques: FrameCritique[];
  /** Scenes Claude reviewed in this pass (their earlier pending rewrites are superseded). */
  reviewed: Set<number>;
  /** Guardrailed rewrites to record; `replaces` is filled in against the merged board. */
  rewrites: Omit<PendingRewrite, "replaces">[];
}

/**
 * One storyboard's first pass: the renders, then Claude's review. A frame lands (attempt 1) only once
 * reviewed and not marked unsafe; an unsafe frame is never written. Each guardrailed rewrite becomes a
 * pending prompt. Null, with nothing saved, when no frame came back or the review failed: frames are
 * never saved as if reviewed.
 */
async function renderBoard(ctx: BoardContext): Promise<BoardOutcome | null> {
  const { deps, slug, report, board, renderer } = ctx;
  const { log } = deps;
  const { entry } = board;
  const product = report.inputs.product;
  const label = `${slug}/${entry.key}`;

  const firsts = await renderPlans(renderer, board.frames, ctx.refUrls, (plan, message) => log(`${label} shot ${plan.scene + 1}: did not render: ${message}`));
  if (firsts.length === 0) {
    log(`${label}: no frame came back; the manifest is unchanged.`);
    return null;
  }

  let review: CritiqueResult;
  try {
    review = await critiqueFrames(deps.model as LanguageModel, {
      frames: firsts.map((r) => ({ scene: r.plan.scene, url: dataUri(r.bytes, CONTENT_TYPES[r.format]), body: r.plan.body })),
      concept: entry.pack.concept,
      brief: entry.brief,
      product,
      checklist: frameChecklist(entry.pack, product),
      names: ctx.names,
    });
  } catch (error) {
    review = { critiques: [], refused: [], unsafe: [], failure: error instanceof Error ? error.message : String(error) };
  }
  if (review.failure) {
    log(`${label}: Claude's review failed (${review.failure}), so nothing is saved for this storyboard: frames are never kept unreviewed. Render it again.`);
    return null;
  }
  for (const refused of review.refused) log(`${label} shot ${refused.scene + 1}: no rewrite recorded, it was refused: ${refused.reason}`);
  for (const c of review.critiques.filter((x) => x.issues.length > 0)) log(`${label} shot ${c.scene + 1}: ${c.issues.join("; ")}`);

  const reviewed = new Set(review.critiques.map((c) => c.scene));
  const unsafe = new Set(review.unsafe);
  for (const r of firsts) {
    if (!reviewed.has(r.plan.scene)) log(`${label} shot ${r.plan.scene + 1}: Claude's review left it out, so it is not saved.`);
    else if (unsafe.has(r.plan.scene)) log(`${label} shot ${r.plan.scene + 1}: held back, Claude marked it unsafe; it is not written.`);
  }
  const landed = firsts
    .filter((r) => reviewed.has(r.plan.scene) && !unsafe.has(r.plan.scene))
    .sort((a, b) => a.plan.scene - b.plan.scene)
    .map((r) => ({
      frame: { scene: r.plan.scene, file: framePath(slug, entry.key, r.plan.scene, r.format), promptHash: r.plan.promptHash, sha256: sha256Of(r.bytes), modelId: r.plan.model.endpoint, attempt: 1 as const },
      bytes: r.bytes,
    }));

  const byScene = new Map(firsts.map((r) => [r.plan.scene, r]));
  const rewrites: BoardOutcome["rewrites"] = review.critiques.flatMap((c) => {
    const first = byScene.get(c.scene);
    if (c.rewrite === null || !first) return [];
    const plan = rewritePlan(first.plan, c.rewrite, board.reference);
    const issues = frameGuard(plan.prompt, ctx.names, entry.brief, product);
    if (issues.length > 0) {
      log(`${label} shot ${c.scene + 1}: no rewrite recorded, the rewritten prompt was refused: ${issues[0].message}`);
      return [];
    }
    return [{ segmentId: entry.segmentId, scene: c.scene, issues: c.issues, body: plan.body, prompt: plan.prompt, promptHash: plan.promptHash, modelId: plan.model.endpoint, referenceIds: plan.referenceIds }];
  });
  // Nothing re-rendered in this pass, so no critique carries a rewrite yet (the report's rule).
  const critiques: FrameCritique[] = review.critiques.map((c) => ({ ...c, rewrite: null }));
  return { landed, critiques, reviewed, rewrites };
}

// --- storyboards --rerender --------------------------------------------------------------------------

interface RerenderItem {
  pending: PendingRewrite;
  key: string;
  plan: FramePlan | null;
  status: "ready" | "unapproved" | "stale" | "blocked";
  reason: string | null;
}

/**
 * Renders the pending rewrites whose hashes the founder approved, at most one per scene, and puts each
 * in its board as attempt 2 in place of the frame it was written for. A rewrite whose board changed
 * since (re-rendered, another packshot) is stale and never renders; nor does an unapproved one.
 */
export async function rerenderCommand(deps: DemoDeps, slugArg: string, select: StoryboardSelect, flags: SpendFlags): Promise<CommandResult> {
  const slug = exampleSlug(slugArg);
  const { log } = deps;
  const report = loadExampleReport(slug, deps.root);
  const manifest = await readManifest(deps.root);
  const approvals = await readApprovals(deps.root);
  const reference = demoMediaFor(manifest, approvals, slug).packshot;
  const names = reportNames(report);
  let entries;
  try {
    entries = selectBoards(report, select);
  } catch (error) {
    throw new DemoRefusal(error instanceof Error ? error.message : String(error));
  }
  const selected = new Set(entries.map((e) => e.segmentId));
  const pending = await readPending(deps.root, slug);
  const seen = new Set<string>();
  const items: RerenderItem[] = pending
    .filter((p) => selected.has(p.segmentId))
    .map((p) => {
      const entry = entries.find((e) => e.segmentId === p.segmentId)!;
      const item = (status: RerenderItem["status"], reason: string | null, plan: FramePlan | null = null): RerenderItem => ({ pending: p, key: entry.key, plan, status, reason });
      const sceneKey = `${entry.key}/${p.scene}`;
      if (seen.has(sceneKey)) return item("stale", "a second rewrite for the same scene");
      seen.add(sceneKey);
      const first = storyboardPlan(report, entry, reference, names).frames.find((f) => f.scene === p.scene);
      if (!first) return item("stale", "the scene is no longer in the storyboard plan");
      // Rebuilt from the recorded body: the hash must match, so the approval pins exactly this prompt.
      const plan = rewritePlan(first, p.body, reference);
      if (plan.promptHash !== p.promptHash || plan.prompt !== p.prompt) return item("stale", "the packshot or the frame template changed since it was written");
      const issues = frameGuard(plan.prompt, names, entry.brief, report.inputs.product);
      if (issues.length > 0) return item("blocked", issues[0].message);
      const frame = manifest.storyboards.find((s) => s.example === slug && s.segmentId === p.segmentId)?.frames.find((f) => f.scene === p.scene);
      const current = p.replaces ? frame?.promptHash === p.replaces.promptHash && frame.sha256 === p.replaces.sha256 : !frame;
      if (!current) return item("stale", "the storyboard was rendered again since");
      return approvals.prompts.includes(p.promptHash) ? item("ready", null, plan) : item("unapproved", "its promptHash is not in approvals.json", plan);
    });

  const perFrame = (item: RerenderItem) => item.plan?.model.usdPerFrame ?? 0;
  for (const item of items) {
    log(`${slug}/${item.key} shot ${item.pending.scene + 1}: rewrite ${item.pending.promptHash} ${item.status === "ready" ? "approved, will re-render" : `not rendered (${item.reason})`}`);
    log(`    issues: ${item.pending.issues.join("; ") || "-"}`);
    log(`    ${item.pending.prompt.replace(/\n+/g, " ")}`);
  }
  const ready = items.filter((i) => i.status === "ready");
  const cost = ready.reduce((sum, i) => sum + perFrame(i), 0);
  log(`${slug}: ${items.length} pending rewrite(s), ${ready.length} approved: ${ready.length} images, estimated ${usd(cost)}.`);
  const replaced = ready.flatMap((i) => {
    const frame = manifest.storyboards.find((s) => s.example === slug && s.segmentId === i.pending.segmentId)?.frames.find((f) => f.scene === i.pending.scene);
    return frame ? [frame] : [];
  });
  guardApproved(replaced, approvals, flags.replace, log, flags.dryRun);
  if (flags.dryRun) return { status: "dry-run", written: [] };
  if (ready.length === 0) throw new DemoRefusal(`No approved rewrite to re-render. Read the pending ones (${path.relative(deps.root, pendingFile(deps.root, slug))}), add the hashes you approve to approvals.json "prompts", then run this again.`);
  if (!flags.yes) throw new DemoRefusal(`Nothing rendered: add --yes to spend about ${usd(cost)}.`);
  const cap = capOf(deps);
  if (ready.length > cap) throw new DemoRefusal(`${ready.length} re-renders; one invocation renders at most ${cap}. Pass --segment <id> or --control.`);
  if (!deps.renderers) throw new DemoRefusal("No fal renderer: set FAL_KEY in your local env file.");

  const renderer = cappedRenderer(deps.renderers.frame, { used: 0, max: cap });
  const refUrls = reference ? [await referenceUri(deps, slug, reference)] : [];
  const rendered = await renderPlans(
    renderer,
    ready.map((i) => i.plan as FramePlan),
    refUrls,
    (plan, message) => log(`${slug} shot ${plan.scene + 1}: did not re-render: ${message}. The rewrite stays pending.`),
  );
  let current = await readManifest(deps.root);
  let remaining = await readPending(deps.root, slug);
  const written: string[] = [];
  for (const r of rendered) {
    const item = ready.find((i) => i.plan === r.plan)!;
    const { segmentId, scene, issues, body } = item.pending;
    const file = framePath(slug, item.key, scene, r.format);
    const frame: DemoFrame = { scene, file, promptHash: r.plan.promptHash, sha256: sha256Of(r.bytes), modelId: r.plan.model.endpoint, attempt: 2 };
    const old = current.storyboards.find((s) => s.example === slug && s.segmentId === segmentId);
    const replacedFrame = old?.frames.find((f) => f.scene === scene);
    // The scene's critique is the one this rewrite answers, now shown with the rewrite that re-rendered.
    const critiques = [...(old?.critiques.filter((c) => c.scene !== scene) ?? []), { scene, issues: issues.slice(0, 6), rewrite: body }].sort((a, b) => a.scene - b.scene);
    const board: DemoStoryboard = {
      example: slug,
      segmentId,
      frames: [...(old?.frames.filter((f) => f.scene !== scene) ?? []), frame].sort((a, b) => a.scene - b.scene),
      critiques,
    };
    // Validated before the file lands, so a schema failure leaves no orphan.
    current = manifestSchema.parse({ ...current, storyboards: [...current.storyboards.filter((s) => s !== old), board] });
    await writeDemoFile(deps.root, slug, file, r.bytes);
    if (replacedFrame && replacedFrame.file !== file) await removeDemoFile(deps.root, slug, replacedFrame.file);
    await writeManifest(deps.root, current);
    current = await readManifest(deps.root);
    remaining = remaining.filter((p) => !(p.segmentId === segmentId && p.scene === scene));
    await writePending(deps.root, slug, remaining);
    written.push(file);
    log(`${slug}/${item.key} shot ${scene + 1}: re-rendered as ${file} (sha256 ${frame.sha256}).`);
  }
  for (const line of await approveList(deps, slug)) log(line);
  return { status: "done", written };
}

// --- clip ---------------------------------------------------------------------------------------------

export const CLIP_ROLES = ["hero-control", "hero-culture", "control", "culture"] as const;
export type ClipRole = (typeof CLIP_ROLES)[number];
/** About 2 MB is the target (720x1280 H.264); anything past this is not a web clip. */
export const MAX_CLIP_BYTES = 40 * 1024 * 1024;
const MAX_CAPTION_BYTES = 200 * 1024;

export interface ClipArgs {
  file: string;
  example: string;
  role: string;
  segment?: string | null;
  promptHash: string;
  poster?: string | null;
  captions?: string | null;
  dryRun: boolean;
  /** Replace a clip whose file the founder already approved. */
  replace?: boolean;
}

function videoKind(bytes: Uint8Array): "mp4" | "webm" | null {
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp") return "mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return null;
}

/**
 * Registers a clip the founder rendered from an approved render prompt of the example's Control pack
 * (control roles) or of one world's pack (culture roles): copies it under public/demo/<slug>/ as it is,
 * with an optional poster image and WebVTT captions, and writes its manifest entry with the file's sha256.
 */
export async function clipCommand(deps: DemoDeps, args: ClipArgs): Promise<CommandResult> {
  const slug = exampleSlug(args.example);
  const { log } = deps;
  if (!(CLIP_ROLES as readonly string[]).includes(args.role)) throw new DemoRefusal(`--role must be one of ${CLIP_ROLES.join(", ")}.`);
  const role = args.role as ClipRole;
  const isControl = role === "control" || role === "hero-control";
  const segment = args.segment ?? null;
  if (isControl && segment) throw new DemoRefusal(`A ${role} clip has no segment.`);
  if (!isControl && !segment) throw new DemoRefusal(`A ${role} clip needs --segment <id>.`);
  const report = loadExampleReport(slug, deps.root);
  const entry = reportPacks(report).find((p) => p.segmentId === segment);
  if (!entry) throw new DemoRefusal(`${slug} has no world "${segment}". Worlds: ${report.worlds.map((w) => w.segmentId).join(", ")}.`);
  const render = entry.pack.renders.find((r) => r.promptHash === args.promptHash);
  if (!render) throw new DemoRefusal(`${args.promptHash} is not a render prompt of ${slug}/${entry.key}'s pack.`);
  const approvals = await readApprovals(deps.root);
  if (!approvals.prompts.includes(args.promptHash)) throw new DemoRefusal(`${args.promptHash} (${slug}/${entry.key}/${render.id}) is not approved; a clip is registered only from an approved prompt.`);

  const source = path.resolve(args.file);
  if (!existsSync(source)) throw new DemoRefusal(`No file at ${args.file}.`);
  const size = (await stat(source)).size;
  if (size === 0 || size > MAX_CLIP_BYTES) throw new DemoRefusal(`${args.file} is ${size} bytes; a demo clip is between 1 byte and ${MAX_CLIP_BYTES} bytes.`);
  const bytes = new Uint8Array(await readFile(source));
  const kind = videoKind(bytes);
  if (!kind || path.extname(source).slice(1).toLowerCase() !== kind) throw new DemoRefusal(`${args.file} is not an .mp4 or .webm video (by its name and its bytes).`);

  let poster: { bytes: Uint8Array; format: ImageFormat } | null = null;
  if (args.poster) {
    if (!existsSync(path.resolve(args.poster))) throw new DemoRefusal(`No poster at ${args.poster}.`);
    const posterBytes = new Uint8Array(await readFile(path.resolve(args.poster)));
    const format = imageFormatOf(posterBytes);
    if (!format || posterBytes.byteLength > MAX_DEMO_IMAGE_BYTES) throw new DemoRefusal(`${args.poster} is not a ${IMAGE_FORMATS.join(", ")} image under ${MAX_DEMO_IMAGE_BYTES} bytes.`);
    poster = { bytes: posterBytes, format };
  }
  let captions: Uint8Array | null = null;
  if (args.captions) {
    if (!existsSync(path.resolve(args.captions))) throw new DemoRefusal(`No captions at ${args.captions}.`);
    // Copied byte for byte; WebVTT may open with a UTF-8 byte order mark before its "WEBVTT" line.
    const raw = new Uint8Array(await readFile(path.resolve(args.captions)));
    const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 3 : 0;
    const head = Buffer.from(raw.subarray(bom, bom + 6)).toString("latin1");
    if (head !== "WEBVTT" || raw.byteLength > MAX_CAPTION_BYTES) throw new DemoRefusal(`${args.captions} is not a WebVTT file under ${MAX_CAPTION_BYTES} bytes.`);
    captions = raw;
  }

  const base = `${role}${segment ? `-${segment}` : ""}`;
  const id = `${slug}-${base}`;
  const clipFile = `/demo/${slug}/${base}.${kind}`;
  const posterFile = poster ? `/demo/${slug}/${base}.poster.${EXTENSIONS[poster.format]}` : null;
  const captionsFile = captions ? `/demo/${slug}/${base}.vtt` : null;
  const clip: DemoClip = { id, example: slug, role, segmentId: segment, file: clipFile, poster: posterFile, captions: captionsFile, promptHash: args.promptHash, sha256: sha256Of(bytes) };
  const manifest = await readManifest(deps.root);
  // The whole next manifest is validated before any file lands, so a schema failure leaves no orphan.
  const next = manifestSchema.parse({ ...manifest, clips: [...manifest.clips.filter((c) => c.id !== id), clip] });
  log(`${slug}: clip ${id} from ${render.id} (${entry.key}), ${size} bytes, sha256 ${clip.sha256}`);
  log(`  writes ${[clipFile, posterFile, captionsFile].filter(Boolean).join(", ")}`);
  const existing = manifest.clips.filter((c) => c.id === id);
  guardApproved(existing, approvals, args.replace, log, args.dryRun);
  if (args.dryRun) return { status: "dry-run", written: [] };

  await writeDemoFile(deps.root, slug, clipFile, bytes);
  if (posterFile && poster) await writeDemoFile(deps.root, slug, posterFile, poster.bytes);
  if (captionsFile && captions) await writeDemoFile(deps.root, slug, captionsFile, captions);
  for (const old of existing) {
    for (const file of [old.file, old.poster, old.captions]) if (file && ![clipFile, posterFile, captionsFile].includes(file)) await removeDemoFile(deps.root, slug, file);
  }
  await writeManifest(deps.root, next);
  for (const line of await approveList(deps, slug)) log(line);
  return { status: "done", written: [clipFile, posterFile, captionsFile].filter((f): f is string => f !== null) };
}

// --- approve-list -------------------------------------------------------------------------------------

/**
 * What an example has that approvals.json does not approve yet: prompt hashes (the manifest's and the
 * pending rewrites'), file hashes (packshot, frames and clips, after viewing or watching them) and hero
 * clips. Lines to paste by hand; this never writes approvals.json.
 */
export async function approveList(deps: Pick<DemoDeps, "root">, slugArg: string): Promise<string[]> {
  const slug = exampleSlug(slugArg);
  const manifest = await readManifest(deps.root);
  const approvals = await readApprovals(deps.root);
  const pending = await readPending(deps.root, slug);
  const prompts = new Set(approvals.prompts);
  const files = new Set(approvals.files);
  const needPrompt = new Map<string, string>();
  const needFile = new Map<string, string>();
  const heroes: DemoApprovals["heroClips"] = [];
  for (const p of manifest.packshots.filter((x) => x.example === slug)) {
    if (!prompts.has(p.promptHash)) needPrompt.set(p.promptHash, `packshot ${p.file}`);
    if (!files.has(p.sha256)) needFile.set(p.sha256, `packshot ${p.file}`);
  }
  for (const board of manifest.storyboards.filter((x) => x.example === slug)) {
    const key = board.segmentId ?? CONTROL_SEGMENT;
    for (const f of board.frames) {
      if (!prompts.has(f.promptHash)) needPrompt.set(f.promptHash, `storyboard ${key} shot ${f.scene + 1}${f.attempt === 2 ? " (critique rewrite)" : ""}`);
      if (!files.has(f.sha256)) needFile.set(f.sha256, `storyboard ${key} shot ${f.scene + 1}, ${f.file}`);
    }
  }
  // Rewrites are prompts nobody has seen yet: they get their own block, so they are never approved in bulk with the files.
  const needRewrite = pending.filter((p) => !prompts.has(p.promptHash));
  for (const c of manifest.clips.filter((x) => x.example === slug)) {
    if (!prompts.has(c.promptHash)) needPrompt.set(c.promptHash, `clip ${c.id}`);
    if (!files.has(c.sha256)) needFile.set(c.sha256, `clip ${c.id}, ${c.file} (after watching it)`);
    if ((c.role === "hero-control" || c.role === "hero-culture") && !approvals.heroClips.some((h) => h.id === c.id && h.promptHash === c.promptHash && h.sha256 === c.sha256)) {
      heroes.push({ id: c.id, promptHash: c.promptHash, sha256: c.sha256 });
    }
  }
  const ready = pending.filter((p) => prompts.has(p.promptHash));
  const readyLine = ready.length ? [`${ready.length} approved rewrite(s) wait to re-render: npm run render:demo -- storyboards ${slug} --rerender --yes`] : [];
  const rewriteBlock = needRewrite.length
    ? [
        "",
        `Pending critique rewrites (not rendered). Read each prompt in ${path.join("exports", slug, "pending-rewrites.json")} first; approve only the ones you want re-rendered:`,
        ...needRewrite.flatMap((p) => [`  rewrite ${p.promptHash}  storyboard ${p.segmentId ?? CONTROL_SEGMENT} shot ${p.scene + 1}: ${p.issues.join("; ") || "no issue listed"}`, `    ${p.prompt.replace(/\n+/g, " ")}`]),
        ...approvedLines("prompts", needRewrite.map((p) => p.promptHash)),
        `Then: npm run render:demo -- storyboards ${slug} --rerender --yes`,
      ]
    : [];
  const manifestBlock =
    needPrompt.size + needFile.size + heroes.length === 0
      ? [`${slug}: everything in the manifest is approved.`]
      : [
          `${slug}: in the manifest but not approved. Read each prompt and view each file before approving it.`,
          ...[...needPrompt].map(([hash, what]) => `  prompt ${hash}  ${what}`),
          ...[...needFile].map(([hash, what]) => `  file   ${hash}  ${what}`),
          ...heroes.map((h) => `  hero   ${h.id} (after watching it)`),
          ...approvedLines("prompts", [...needPrompt.keys()]),
          ...approvedLines("files", [...needFile.keys()]),
          ...(heroes.length ? ['Add to approvals.json "heroClips":', ...heroes.map((h) => `  ${JSON.stringify(h)},`)] : []),
        ];
  return [...manifestBlock, ...rewriteBlock, ...readyLine];
}
