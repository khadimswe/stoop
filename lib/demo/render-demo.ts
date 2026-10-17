// The commands behind scripts/render-demo.ts: the examples' demo media, made offline by the founder.
//   packshot     one product image per example on fal, from the report pack's packshot asset prompt
//   storyboards  up to 4 frames per world (or the Control) on fal, critiqued by Claude with one re-render
//   clip         registers a clip the founder rendered in Higgsfield from an approved pack prompt
//   approveList  what is in the manifest but not approved yet, as lines for approvals.json
// Spend rules: every render refuses a prompt hash that is not in public/demo/approvals.json, prints the
// prompts, hashes, model and estimated cost first, renders nothing without --yes (and nothing at all on
// --dry-run), and stops at MAX_IMAGES_PER_INVOCATION images. A critique rewrite is a new prompt: it
// re-renders once and its hash is printed for the founder to approve with the files. A frame Claude
// marks unsafe is never written. Files go under public/demo/<slug>/ only, the manifest is validated
// before every write, and approvals.json is never written: the founder edits it by hand.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFalClient, type FalClient } from "@fal-ai/client";
import type { LanguageModel } from "ai";
import { createFalRenderer, type FrameRenderer } from "../media/frames";
import type { FrameCritique } from "../report/world";
import { reportNames } from "../stages/after-run";
import { critiqueFrames, frameChecklist, type CritiqueResult } from "../stages/critique";
import {
  boardCost,
  framePath,
  frameGuard,
  MAX_IMAGES_PER_INVOCATION,
  PACKSHOT_IMAGE_SIZE,
  packshotPlan,
  rewritePlan,
  selectBoards,
  storyboardPlan,
  usd,
  type BoardPlan,
  type FramePlan,
} from "./demo-renders";
import { approvalsSchema, CONTROL_KEY, demoMediaFor, manifestSchema, type DemoApprovals, type DemoClip, type DemoFrame, type DemoManifest, type DemoPackshot, type DemoStoryboard } from "./manifest";
import { isExampleSlug, loadExampleReport, reportPacks } from "./report-packs";
import type { ExampleSlug } from "./examples";

export class DemoRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoRefusal";
  }
}

export interface DemoRenderers {
  /** Text to image at the packshot's square size. */
  packshot: FrameRenderer;
  /** The storyboard renderer (the live frame adapter). */
  frame: FrameRenderer;
}

export interface DemoDeps {
  /** The repository root: reads data/runs and public/demo, writes public/demo/<slug>/ and the manifest. */
  root: string;
  /** fal, or null where nothing may render (dry runs, a missing key). */
  renderers: DemoRenderers | null;
  /** Claude for the storyboard critique, or null. */
  model: LanguageModel | null;
  log: (line: string) => void;
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Images one invocation may request; never above MAX_IMAGES_PER_INVOCATION. */
  maxImages?: number;
}

export interface SpendFlags {
  dryRun: boolean;
  yes: boolean;
  /** Render over files the founder already approved (they then need a new approval). */
  replace?: boolean;
}

/** Refuses to overwrite an approved file unless --replace: a worse re-render must never destroy the approved one. */
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

// --- Files --------------------------------------------------------------------------------------------

export const manifestFile = (root: string) => path.join(root, "public", "demo", "manifest.json");
export const approvalsFile = (root: string) => path.join(root, "public", "demo", "approvals.json");

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

/** WebP through sharp (installed with Next as its image optimizer), loaded only when a render needs it. */
export async function sharpWebp(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(await sharp(bytes).webp({ quality: 90 }).toBuffer());
}

const dataUri = (bytes: Uint8Array, contentType: string) => `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;

// --- fal ----------------------------------------------------------------------------------------------

/** The live frame adapter, sending fal's square preset instead of the frames' 9:16 (the packshot asset is 1:1). */
export function packshotFalRenderer(options: { credentials: string; client?: Pick<FalClient, "subscribe">; fetch?: typeof fetch }): FrameRenderer {
  const client = options.client ?? createFalClient({ credentials: options.credentials });
  const square = {
    subscribe: (endpoint: string, run: { input?: Record<string, unknown> }) => client.subscribe(endpoint, { ...run, input: { ...run.input, image_size: PACKSHOT_IMAGE_SIZE } }),
  } as unknown as Pick<FalClient, "subscribe">;
  return createFalRenderer({ credentials: options.credentials, client: square, ...(options.fetch ? { fetch: options.fetch } : {}) });
}

export function falRenderers(credentials: string): DemoRenderers {
  return { packshot: packshotFalRenderer({ credentials }), frame: createFalRenderer({ credentials }) };
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
  log(`  model ${plan.model.displayName} (${plan.model.endpoint}), ${plan.imageSize}, text to image, no reference`);
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
  const image = await renderer.render({ model: plan.model, prompt: plan.prompt, referenceUrls: [] });
  const webp = await (deps.encodeWebp ?? sharpWebp)(image.bytes);
  await writeDemoFile(deps.root, slug, plan.file, webp);
  const entry: DemoPackshot = { example: slug, file: plan.file, promptHash: plan.promptHash, sha256: sha256Of(webp), modelId: plan.model.endpoint };
  const manifest = await readManifest(deps.root);
  await writeManifest(deps.root, { ...manifest, packshots: [...manifest.packshots.filter((p) => p.example !== slug), entry] });
  log(`${slug}: wrote ${entry.file} (sha256 ${entry.sha256}). View it, then approve the file:`);
  for (const line of approvedLines("files", [entry.sha256])) log(line);
  return { status: "done", written: [entry.file] };
}

// --- storyboards --------------------------------------------------------------------------------------

export interface StoryboardSelect {
  segment?: string | null;
  control?: boolean;
}

interface Rendered {
  plan: FramePlan;
  attempt: 1 | 2;
  webp: Uint8Array;
}

/** The approved packshot as fal's reference (a data URI of the exact file), refusing a file that changed since it was approved. */
async function referenceUri(deps: DemoDeps, slug: string, packshot: DemoPackshot): Promise<string> {
  const file = demoFile(deps.root, slug, packshot.file);
  if (!existsSync(file)) throw new DemoRefusal(`The approved packshot ${packshot.file} is missing.`);
  const bytes = new Uint8Array(await readFile(file));
  if (sha256Of(bytes) !== packshot.sha256) throw new DemoRefusal(`${packshot.file} changed since it was approved (sha256 differs); render and approve it again.`);
  const ext = path.extname(file).slice(1).toLowerCase();
  return dataUri(bytes, ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`);
}

function logBoard(log: (line: string) => void, plan: BoardPlan, approved: ReadonlySet<string>): void {
  const { entry } = plan;
  const cost = boardCost(plan);
  log(`${plan.slug}/${entry.key}: ${entry.segmentId === null ? "the Control" : `world "${entry.label}"`}, concept "${entry.pack.concept.title}"`);
  log(`  model ${plan.frames[0]?.model.displayName ?? "-"} (${plan.frames[0]?.model.endpoint ?? "-"}), ${plan.reference ? `reference ${plan.reference.file} (sha256 ${plan.reference.sha256})` : "text only (no approved packshot)"}`);
  for (const frame of plan.frames) {
    const scene = entry.pack.concept.scenes[frame.scene];
    log(`  shot ${frame.scene + 1} (${scene?.beat ?? "scene"}): promptHash ${frame.promptHash} (${approved.has(frame.promptHash) ? "approved" : "NOT approved"})`);
    log(`    ${frame.prompt.replace(/\n+/g, " ")}`);
  }
  for (const b of plan.blocked) log(`  shot ${b.scene + 1}: left out, its prompt breaks the guardrails: ${b.message}`);
  log(`  estimated cost: ${usd(cost.usd.renders)} for ${cost.firstRenders} frames, up to ${usd(cost.usd.rerenders)} for ${cost.maxRerenders} re-renders, about ${usd(cost.usd.critique)} for Claude's review: at most ${usd(cost.usd.total)}`);
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
  const worst = boards.reduce((sum, b) => sum + boardCost(b).firstRenders + boardCost(b).maxRerenders, 0);
  const total = boards.reduce((sum, b) => sum + boardCost(b).usd.total, 0);
  log(`${slug}: ${boards.length} storyboard${boards.length === 1 ? "" : "s"}, at most ${worst} images, at most ${usd(total)} in all.`);

  // Fairness: every storyboard of an example renders on the same model with the same reference, so
  // only the brief differs. A board left as it is must match what these would render.
  const selected = new Set(boards.map((b) => b.entry.segmentId));
  const endpoint = boards[0]?.frames[0]?.model.endpoint;
  const entries = reportPacks(report);
  const mismatched = manifest.storyboards
    .filter((s) => s.example === slug && !selected.has(s.segmentId))
    .filter((s) => {
      const entry = entries.find((e) => e.segmentId === s.segmentId);
      const expected = new Set(entry ? storyboardPlan(report, entry, reference, names).frames.map((f) => f.promptHash) : []);
      return s.frames.some((f) => f.modelId !== endpoint || (f.attempt === 1 && !expected.has(f.promptHash)));
    })
    .map((s) => s.segmentId ?? CONTROL_KEY);
  const together = `Every storyboard of an example renders on one model with one reference (only the brief differs): render them together with \`storyboards ${slug}\` (no --segment or --control).`;
  if (mismatched.length > 0 && flags.dryRun) log(`  the ${mismatched.join(", ")} storyboard(s) were rendered with another model or packshot. ${together}`);
  const replaced = manifest.storyboards.filter((s) => s.example === slug && selected.has(s.segmentId)).flatMap((s) => s.frames);
  guardApproved(replaced, approvals, flags.replace, log, flags.dryRun);
  if (flags.dryRun) return { status: "dry-run", written: [] };
  if (mismatched.length > 0) throw new DemoRefusal(`The ${mismatched.join(", ")} storyboard(s) were rendered with another model or packshot than these would be. ${together}`);

  const blocked = boards.flatMap((b) => b.blocked.map((x) => `${b.entry.key} shot ${x.scene + 1}`));
  if (blocked.length > 0) throw new DemoRefusal(`Frame prompts break the guardrails (${blocked.join(", ")}); nothing rendered.`);
  const unapproved = [...new Set(boards.flatMap((b) => b.frames.map((f) => f.promptHash)).filter((h) => !approved.has(h)))];
  if (unapproved.length > 0) throw new DemoRefusal([`${unapproved.length} frame prompt(s) are not approved; nothing rendered. After reading them, add to approvals.json "prompts":`, ...unapproved.map((h) => `  "${h}",`)].join("\n"));
  if (!flags.yes) throw new DemoRefusal(`Nothing rendered: add --yes to spend at most ${usd(total)}.`);
  const cap = capOf(deps);
  if (worst > cap) throw new DemoRefusal(`These storyboards could take ${worst} images; one invocation renders at most ${cap}. Pass --segment <id> or --control.`);
  if (!deps.renderers) throw new DemoRefusal("No fal renderer: set FAL_KEY in your local env file.");
  if (!deps.model) throw new DemoRefusal("No Claude model for the frame review: set ANTHROPIC_API_KEY in your local env file.");

  const budget = { used: 0, max: cap };
  const renderer = cappedRenderer(deps.renderers.frame, budget);
  const refUrls = reference ? [await referenceUri(deps, slug, reference)] : [];
  const written: string[] = [];
  const rewriteHashes: string[] = [];
  for (const board of boards) {
    const outcome = await renderBoard({ deps, slug, report, names, renderer, refUrls, board });
    if (!outcome) continue;
    // Each storyboard lands in the manifest as soon as it is done, so a later failure keeps it.
    const current = await readManifest(deps.root);
    const old = current.storyboards.find((s) => s.example === slug && s.segmentId === board.entry.segmentId);
    const keep = new Set(outcome.storyboard.frames.map((f) => f.file));
    for (const frame of old?.frames ?? []) {
      if (!keep.has(frame.file)) await rm(demoFile(deps.root, slug, frame.file), { force: true });
    }
    const others = current.storyboards.filter((s) => s !== old);
    await writeManifest(deps.root, { ...current, storyboards: [...others, outcome.storyboard] });
    written.push(...outcome.storyboard.frames.map((f) => f.file));
    rewriteHashes.push(...outcome.storyboard.frames.filter((f) => f.attempt === 2).map((f) => f.promptHash));
  }
  log(`${slug}: ${budget.used} images rendered, ${written.length} frames kept.`);
  const lines = await approveList(deps, slug);
  for (const line of lines) log(line);
  if (rewriteHashes.length > 0) log(`${rewriteHashes.length} frame(s) come from a critique rewrite: approve their prompt hashes (above) together with the files, after reading the rewrites in the manifest.`);
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

/** One storyboard: first renders, Claude's review, one re-render per kept rewrite, then the frames to keep. Writes the kept frames. */
async function renderBoard(ctx: BoardContext): Promise<{ storyboard: DemoStoryboard } | null> {
  const { deps, slug, report, board, renderer } = ctx;
  const { log } = deps;
  const encode = deps.encodeWebp ?? sharpWebp;
  const { entry } = board;
  const product = report.inputs.product;
  const label = `${slug}/${entry.key}`;

  const renderAll = async (plans: readonly FramePlan[], attempt: 1 | 2): Promise<Rendered[]> => {
    const settled = await Promise.allSettled(
      plans.map(async (plan) => {
        const image = await renderer.render({ model: plan.model, prompt: plan.prompt, referenceUrls: ctx.refUrls });
        return { plan, attempt, webp: await encode(image.bytes) } satisfies Rendered;
      }),
    );
    settled.forEach((s, i) => {
      if (s.status === "rejected") {
        if (s.reason instanceof DemoRefusal) throw s.reason;
        log(`${label} shot ${plans[i].scene + 1}: did not ${attempt === 1 ? "render" : "re-render"}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
      }
    });
    return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  };

  const firsts = await renderAll(board.frames, 1);
  if (firsts.length === 0) {
    log(`${label}: no frame came back; the manifest is unchanged.`);
    return null;
  }

  let review: CritiqueResult;
  try {
    review = await critiqueFrames(deps.model as LanguageModel, {
      frames: firsts.map((r) => ({ scene: r.plan.scene, url: dataUri(r.webp, "image/webp"), body: r.plan.body })),
      concept: entry.pack.concept,
      brief: entry.brief,
      product,
      checklist: frameChecklist(entry.pack, product),
      names: ctx.names,
    });
  } catch (error) {
    review = { critiques: [], refused: [], unsafe: [], failure: error instanceof Error ? error.message : String(error) };
  }
  if (review.failure) log(`${label}: no review (${review.failure}); the frames stand as rendered.`);
  for (const refused of review.refused) log(`${label} shot ${refused.scene + 1}: kept its prompt, the rewrite was refused: ${refused.reason}`);

  const byScene = new Map(firsts.map((r) => [r.plan.scene, r]));
  const replans = review.critiques.flatMap((c) => {
    const first = byScene.get(c.scene);
    if (c.rewrite === null || !first) return [];
    const plan = rewritePlan(first.plan, c.rewrite, board.reference);
    const issues = frameGuard(plan.prompt, ctx.names, entry.brief, product);
    if (issues.length === 0) return [plan];
    log(`${label} shot ${c.scene + 1}: kept its prompt, the rewritten prompt was refused: ${issues[0].message}`);
    return [];
  });
  const seconds = new Map((await renderAll(replans, 2)).map((r) => [r.plan.scene, r]));

  const unsafe = new Set(review.unsafe);
  const kept: Rendered[] = [];
  for (const first of firsts) {
    const second = seconds.get(first.plan.scene);
    if (second) kept.push(second);
    else if (!unsafe.has(first.plan.scene)) kept.push(first);
    else log(`${label} shot ${first.plan.scene + 1}: held back, Claude marked it unsafe and no clean re-render replaced it.`);
  }
  for (const c of review.critiques.filter((x) => x.issues.length > 0)) log(`${label} shot ${c.scene + 1}: ${c.issues.join("; ")}${seconds.has(c.scene) ? ` | rewrite: ${c.rewrite}` : ""}`);
  // A rewrite that never re-rendered is not shown as one.
  const critiques: FrameCritique[] = review.critiques.map((c) => (c.rewrite !== null && !seconds.has(c.scene) ? { ...c, rewrite: null } : c));
  if (kept.length === 0) {
    log(`${label}: every frame was held back; the manifest is unchanged.`);
    return null;
  }

  const frames: DemoFrame[] = [];
  for (const r of kept.sort((a, b) => a.plan.scene - b.plan.scene)) {
    const file = framePath(slug, entry.key, r.plan.scene);
    await writeDemoFile(deps.root, slug, file, r.webp);
    frames.push({ scene: r.plan.scene, file, promptHash: r.plan.promptHash, sha256: sha256Of(r.webp), modelId: r.plan.model.endpoint, attempt: r.attempt });
  }
  return { storyboard: { example: slug, segmentId: entry.segmentId, frames, critiques } };
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
 * (control roles) or of one world's pack (culture roles): copies it under public/demo/<slug>/, with an
 * optional WebP poster and WebVTT captions, and writes its manifest entry with the file's sha256.
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

  const base = `${role}${segment ? `-${segment}` : ""}`;
  const id = `${slug}-${base}`;
  const clipFile = `/demo/${slug}/${base}.${kind}`;
  const posterFile = args.poster ? `/demo/${slug}/${base}.poster.webp` : null;
  const captionsFile = args.captions ? `/demo/${slug}/${base}.vtt` : null;
  if (args.poster && !existsSync(path.resolve(args.poster))) throw new DemoRefusal(`No poster at ${args.poster}.`);
  if (args.captions && !existsSync(path.resolve(args.captions))) throw new DemoRefusal(`No captions at ${args.captions}.`);
  let captions: Uint8Array | null = null;
  if (args.captions) {
    const text = await readFile(path.resolve(args.captions), "utf8");
    if (!text.startsWith("WEBVTT") || Buffer.byteLength(text) > MAX_CAPTION_BYTES) throw new DemoRefusal(`${args.captions} is not a WebVTT file under ${MAX_CAPTION_BYTES} bytes.`);
    captions = new TextEncoder().encode(text);
  }
  const clip: DemoClip = { id, example: slug, role, segmentId: segment, file: clipFile, poster: posterFile, captions: captionsFile, promptHash: args.promptHash, sha256: sha256Of(bytes) };
  manifestSchema.parse({ version: 2, clips: [clip], storyboards: [], packshots: [] });
  log(`${slug}: clip ${id} from ${render.id} (${entry.key}), ${size} bytes, sha256 ${clip.sha256}`);
  log(`  writes ${[clipFile, posterFile, captionsFile].filter(Boolean).join(", ")}`);
  guardApproved((await readManifest(deps.root)).clips.filter((c) => c.id === id), approvals, args.replace, log, args.dryRun);
  if (args.dryRun) return { status: "dry-run", written: [] };

  await writeDemoFile(deps.root, slug, clipFile, bytes);
  if (posterFile && args.poster) await writeDemoFile(deps.root, slug, posterFile, await (deps.encodeWebp ?? sharpWebp)(new Uint8Array(await readFile(path.resolve(args.poster)))));
  if (captionsFile && captions) await writeDemoFile(deps.root, slug, captionsFile, captions);
  const manifest = await readManifest(deps.root);
  await writeManifest(deps.root, { ...manifest, clips: [...manifest.clips.filter((c) => c.id !== id), clip] });
  for (const line of await approveList(deps, slug)) log(line);
  return { status: "done", written: [clipFile, posterFile, captionsFile].filter((f): f is string => f !== null) };
}

// --- approve-list -------------------------------------------------------------------------------------

/**
 * What the manifest holds for an example that approvals.json does not approve yet: prompt hashes,
 * file hashes (packshot and frames, after viewing them) and hero clips. Lines to paste by hand; this
 * never writes approvals.json.
 */
export async function approveList(deps: Pick<DemoDeps, "root">, slugArg: string): Promise<string[]> {
  const slug = exampleSlug(slugArg);
  const manifest = await readManifest(deps.root);
  const approvals = await readApprovals(deps.root);
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
    const key = board.segmentId ?? CONTROL_KEY;
    for (const f of board.frames) {
      if (!prompts.has(f.promptHash)) needPrompt.set(f.promptHash, `storyboard ${key} shot ${f.scene + 1}${f.attempt === 2 ? " (critique rewrite)" : ""}`);
      if (!files.has(f.sha256)) needFile.set(f.sha256, `storyboard ${key} shot ${f.scene + 1}, ${f.file}`);
    }
  }
  for (const c of manifest.clips.filter((x) => x.example === slug)) {
    if (!prompts.has(c.promptHash)) needPrompt.set(c.promptHash, `clip ${c.id}`);
    if (!files.has(c.sha256)) needFile.set(c.sha256, `clip ${c.id}, ${c.file} (after watching it)`);
    if ((c.role === "hero-control" || c.role === "hero-culture") && !approvals.heroClips.some((h) => h.id === c.id && h.promptHash === c.promptHash && h.sha256 === c.sha256)) {
      heroes.push({ id: c.id, promptHash: c.promptHash, sha256: c.sha256 });
    }
  }
  if (needPrompt.size + needFile.size + heroes.length === 0) return [`${slug}: everything in the manifest is approved.`];
  return [
    `${slug}: in the manifest but not approved. Read each prompt and view each file before approving it.`,
    ...[...needPrompt].map(([hash, what]) => `  prompt ${hash}  ${what}`),
    ...[...needFile].map(([hash, what]) => `  file   ${hash}  ${what}`),
    ...heroes.map((h) => `  hero   ${h.id} (after watching it)`),
    ...approvedLines("prompts", [...needPrompt.keys()]),
    ...approvedLines("files", [...needFile.keys()]),
    ...(heroes.length ? ['Add to approvals.json "heroClips":', ...heroes.map((h) => `  ${JSON.stringify(h)},`)] : []),
  ];
}
