// The Campaign Kit, grouped under each world: the kept concept (cut for Meta and for TikTok), the
// Creative Director's two runner-up concepts, the captions, the ad plan entry and the creator brief,
// each a card with its copy-ready text. The video prompts come from the world's Production Pack, the
// scripts from its kit (spoken as the brand, never as a customer). Every text here is either copied
// from the Report as the stages wrote it or laid out by a tested function in this file. Pure.
import { toCsv } from "../../csv";
import type { DemoMedia } from "../../demo/manifest";
import type { BriefSlots, Concept } from "../../prompts/brief";
import { timecodes } from "../../prompts/lines";
import { getModel } from "../../prompts/models.config";
import type { ProductionPack, RenderJob } from "../../prompts/pack";
import { UGC_FORMAT_SPECS } from "../../prompts/ugc/formats";
import { ageBandLabel, type Cue, type CueOrigin } from "../../types";
import type { Report } from "../schema";
import type { AdPlanEntry, CreatorBrief, Kit, RankedConcept, UgcScript, World } from "../world";
import { currentWorld, keptConcept } from "./current";
import { ledgerOf, receiptView, type Ledger } from "./receipts";
import type { PartialView, ReceiptView, ScriptView } from "./types";
import { latestJobSteps, slotLabel, type TraceStepView } from "./why";

/** A brief ingredient a concept uses, with its origin (and, for the kept concept, its receipt). */
export interface IngredientView {
  slot: string;
  label: string;
  text: string;
  origin: CueOrigin;
  receipt: ReceiptView | null;
}

/** One entry in a card's "Prompts" menu: what it is and the text it copies. */
export interface PromptOptionView {
  id: string;
  group: "video" | "actor";
  /** A model's display name from models.config, or the AI-actor tool. Never hardcoded in a component. */
  label: string;
  detail: string;
  text: string;
}

export interface CopyView {
  label: string;
  text: string;
}

export interface ConceptCardView {
  kind: "concept";
  key: string;
  /** kept: the world's concept; ranked: a runner-up the Creative Director scored lower. */
  status: "kept" | "ranked";
  title: string;
  hook: string;
  emotion: string;
  surprise: string;
  testHypothesis: string | null;
  /** Rubric total out of 30, after the specificity bound. */
  score: number;
  /** The kept card is the Meta cut: its format and platform. */
  formatLabel: string | null;
  platformLabel: string | null;
  ingredients: IngredientView[];
  /** "Copy script" on the kept concept, "Copy concept" on a runner-up. */
  copy: CopyView;
  /** AI-actor exports for this card's platform; the video prompts sit on the world. */
  actorPrompts: PromptOptionView[];
}

export interface CutCardView {
  kind: "cut";
  key: string;
  platform: UgcScript["platform"];
  platformLabel: string;
  formatLabel: string;
  /** What the format's first second does. */
  hookRule: string;
  cta: string;
  conceptTitle: string;
  copy: CopyView;
  actorPrompts: PromptOptionView[];
}

export interface CaptionLineView {
  start: number;
  end: number;
  /** "On screen" (text added in the edit) or "Voice". */
  kind: string;
  text: string;
}

export interface CaptionsCardView {
  kind: "captions";
  key: string;
  lines: CaptionLineView[];
  copy: CopyView;
}

export interface PlanCardView {
  kind: "plan";
  key: string;
  name: string;
  /** Adult labels ("18 to 24"). Optional geo and age options, never a promise of reach. */
  ageBands: string[];
  cities: string[];
  watch: string;
  note: string;
  receipt: ReceiptView | null;
  copy: CopyView;
}

export interface BriefCardView {
  kind: "brief";
  key: string;
  profile: { text: string; origin: CueOrigin; receipt: ReceiptView | null };
  hooks: string[];
  hit: string[];
  avoid: string[];
  disclosure: string;
  copy: CopyView;
}

export type KitCardView = ConceptCardView | CutCardView | CaptionsCardView | PlanCardView | BriefCardView;

export interface KitFrameView {
  scene: number;
  src: string;
  alt: string;
}

/** The kept concept's storyboard as the kit card shows it, plus what "Storyboards" may do on a live report. */
export interface KitStoryboardView {
  /** none: never requested (or for another pack); the rest mirror the frame job. */
  status: "none" | "rendering" | "done" | "paused" | "failed";
  reason: string | null;
  frames: KitFrameView[];
  /** The frame job's agent decisions (the critique, re-renders, frames held back), in its own words. */
  steps: TraceStepView[];
  /** A pack exists and frames are missing, paused or failed: "Storyboards" can be asked for. */
  canRequest: boolean;
}

export interface KitWorldView {
  segmentId: string;
  label: string;
  /** The Creative Director's hook (origin `creative`). */
  hook: string | null;
  testHypothesis: string | null;
  /** How many scripts the world's kit holds (every one is reachable from a card). */
  scriptCount: number;
  /** The revision on show, or null for the world's own pack. */
  revisionId: string | null;
  partial: PartialView | null;
  cards: KitCardView[];
  /** The Production Pack's render prompts, one menu entry per model (shared by both cuts). */
  videoPrompts: PromptOptionView[];
  storyboard: KitStoryboardView;
  /** The rest of the Production Pack as text, for the download (render prompts are joined in from videoPrompts). */
  pack: { file: string; head: string; tail: string } | null;
}

export interface KitView {
  worlds: KitWorldView[];
  counts: { worlds: number; concepts: number; scripts: number };
  downloads: {
    /** "Meta + TikTok ad plan (CSV)". */
    adPlan: { file: string; text: string } | null;
    /** The creator brief for every world, as Markdown. */
    creatorBrief: { file: string; text: string } | null;
  };
}

const PLATFORM_LABELS: Readonly<Record<UgcScript["platform"], string>> = { meta: "Meta Reels and Stories", tiktok: "TikTok" };
const TOOL_LABELS: Readonly<Record<UgcScript["tool"], { label: string; detail: string }>> = {
  arcads: { label: "Arcads", detail: "AI actor script, spoken as the brand" },
  creatify: { label: "Creatify", detail: "AI avatar script, one scene per beat" },
  creator: { label: "Creator script", detail: "For a human creator, spoken as the brand" },
};
const PLATFORMS: readonly UgcScript["platform"][] = ["meta", "tiktok"];

export function scriptView({ format, platform, tool, script, cta }: UgcScript): ScriptView {
  return { format, formatLabel: UGC_FORMAT_SPECS[format].label, platform, tool, script, cta };
}

/** A file-safe name from a label: "Porchlight Pepper Co." is "porchlight-pepper-co". */
export function fileSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "stoop"
  );
}

// --- Brief ingredients --------------------------------------------------------------------------------

function slotCue(brief: BriefSlots, slot: string): Cue | null {
  const setting = /^setting\.(\d)$/.exec(slot);
  if (setting) return brief.setting[Number(setting[1])] ?? null;
  switch (slot) {
    case "productRole":
      return brief.productRole;
    case "mood":
      return brief.mood;
    case "music":
      return brief.music;
    case "visual":
      return brief.visual;
    case "voice.tone":
      return brief.voice.tone;
    case "wardrobe":
      return brief.wardrobe;
    case "talent":
      return brief.talent;
    default:
      return null;
  }
}

/**
 * The brief slots code found in the concept's text, each with its origin and, for Qloo cues, its
 * receipt (no evidence, no display). `receipts` shares one receipt per slot across a world's concepts,
 * which draw on the same brief, so the page sends each once.
 */
export function ingredients(ledger: Ledger, brief: BriefSlots | null, concept: RankedConcept, receipts: Map<string, ReceiptView | null> = new Map()): IngredientView[] {
  if (!brief) return [];
  return concept.verifiedUses.flatMap((slot) => {
    const cue = slotCue(brief, slot);
    if (!cue) return [];
    const label = slotLabel(slot);
    if (!receipts.has(slot)) receipts.set(slot, cue.origin === "qloo" || cue.origin === "interpreted" ? receiptView(ledger, cue.evidenceIds, label, cue.text) : null);
    return [{ slot, label, text: cue.text, origin: cue.origin, receipt: receipts.get(slot) ?? null }];
  });
}

// --- Text layouts ---------------------------------------------------------------------------------------

/** A concept as plain text: what "Copy concept" copies for a runner-up (no prompts are written for it). */
export function conceptText(concept: Concept): string {
  const times = timecodes(concept);
  const shots = concept.scenes.map((scene, i) => {
    const parts = [`Shot ${i + 1} (${scene.beat}, ${times[i].start} to ${times[i].end} s): ${scene.action}`];
    if (scene.overlayText) parts.push(`On screen: "${scene.overlayText}"`);
    if (scene.dialogue) parts.push(`Line: "${scene.dialogue}"`);
    return parts.join(" ");
  });
  return [
    concept.title,
    `Hook: ${concept.hook}`,
    `Emotion: ${concept.emotion}`,
    `Surprise: ${concept.surpriseBeat}`,
    ...(concept.testHypothesis ? [`What this tests: ${concept.testHypothesis}`] : []),
    "",
    ...shots,
    "",
    "Concept by Stoop's Creative Director (not from Qloo). Its cultural details come from this world's Culture Brief.",
  ].join("\n");
}

/** Seconds from a WebVTT timestamp ("00:00:03.000" or "00:03.000"). */
function vttSeconds(stamp: string): number {
  const parts = stamp.trim().split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** WebVTT escapes &, < and > in cue text; the page shows the words as written. */
export function unescapeVtt(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** The captions' cues: time span, whether it is on-screen text or a voice line, and the words. */
export function captionLines(vtt: string): CaptionLineView[] {
  return vtt
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .flatMap((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timing = lines.findIndex((line) => line.includes("-->"));
      if (timing === -1) return [];
      const [start, end] = lines[timing].split("-->").map((side) => side.trim().split(/\s+/)[0]);
      const id = timing > 0 ? lines[timing - 1] : "";
      const text = unescapeVtt(lines.slice(timing + 1).join(" ").trim());
      if (!text) return [];
      return [{ start: Math.round(vttSeconds(start)), end: Math.round(vttSeconds(end)), kind: /voice/i.test(id) ? "Voice" : "On screen", text }];
    });
}

function planText(label: string, plan: AdPlanEntry): string {
  return [
    `${plan.name}`,
    `Concept world: ${label}`,
    `Age bands (optional): ${plan.ageBands.map(ageBandLabel).join(", ") || "none"}`,
    `Cities (optional): ${plan.cities.join(", ") || "none"}`,
    `What to watch: ${plan.watch}`,
    plan.note,
  ].join("\n");
}

function briefText(label: string, brief: CreatorBrief): string {
  const list = (items: readonly string[]) => items.map((item) => `- ${item}`);
  return [
    `## ${label}`,
    "",
    `Who to recruit: ${brief.profile.text}`,
    "",
    "Hooks to try:",
    ...list(brief.hooks),
    "",
    "Hit these details:",
    ...list(brief.hit),
    "",
    "Avoid:",
    ...list(brief.avoid),
    "",
    `Disclosure: ${brief.disclosure}`,
  ].join("\n");
}

// --- Prompts --------------------------------------------------------------------------------------------

function jobText(job: RenderJob): string {
  const lines = [job.prompt];
  if (job.negative) lines.push("", `Negative prompt: ${job.negative}`);
  return lines.join("\n");
}

/** One menu entry per model: the multi-shot render on its own, each per-scene family as all its scenes. */
export function videoPrompts(pack: ProductionPack): PromptOptionView[] {
  const options: PromptOptionView[] = [];
  const families = new Map<string, RenderJob[]>();
  for (const job of pack.renders) {
    if (job.kind === "multi-shot") {
      const model = getModel(job.modelId);
      options.push({ id: job.id, group: "video", label: model.displayName, detail: `${model.vendor} · one ${job.trimTo} s multi-shot clip`, text: jobText(job) });
      continue;
    }
    families.set(job.modelId, [...(families.get(job.modelId) ?? []), job]);
  }
  for (const [modelId, jobs] of families) {
    const model = getModel(jobs[0].modelId);
    const text = jobs
      .map((job) => {
        const head = `Scene ${job.sceneIndexes.map((i) => i + 1).join(", ")} · render ${job.renderSeconds} s, trim to ${job.trimTo} s${job.refs.length ? ` · references: ${job.refs.join(", ")}` : ""}`;
        return `${head}\n${jobText(job)}`;
      })
      .join("\n\n");
    options.push({ id: modelId, group: "video", label: model.displayName, detail: `${model.vendor} · ${jobs.length} scene ${jobs.length === 1 ? "prompt" : "prompts"}, one per shot`, text });
  }
  return options;
}

function actorPrompts(scripts: readonly UgcScript[], platform: UgcScript["platform"], lead: UgcScript | null): PromptOptionView[] {
  return scripts
    .filter((s) => s.platform === platform && s !== lead)
    .map((s) => ({ id: `${s.tool}-${s.platform}-${s.format}`, group: "actor", label: TOOL_LABELS[s.tool].label, detail: TOOL_LABELS[s.tool].detail, text: s.script }));
}

/** The script a platform's card copies: the human creator's when there is one, else the first. */
export function leadFor(scripts: readonly UgcScript[], platform: UgcScript["platform"]): UgcScript | null {
  const own = scripts.filter((s) => s.platform === platform);
  return own.find((s) => s.tool === "creator") ?? own[0] ?? null;
}

/** The Production Pack minus its render prompts (the download joins those in from the menu's entries). */
export function packParts(brand: string, label: string, pack: ProductionPack): { file: string; head: string; tail: string } {
  const assets = pack.assets.flatMap((asset) => {
    const model = getModel(asset.modelId);
    return [
      `### ${asset.file} (${model.displayName}, ${asset.aspect})`,
      "",
      asset.prompt,
      ...(asset.refs.length ? ["", `References: ${asset.refs.join(", ")}`] : []),
      ...(asset.negative ? ["", `Negative prompt: ${asset.negative}`] : []),
      "",
    ];
  });
  const head = [
    `# Production Pack: ${brand}, ${label}`,
    "",
    "Review every prompt before you render. Nothing here auto-publishes.",
    "",
    "## Concept",
    "",
    conceptText(pack.concept),
    "",
    "## Asset sheets (render these first; the scene prompts reference them by filename)",
    "",
    ...assets,
    "## Render prompts",
  ].join("\n");
  const tail = [
    "## Shot list",
    "",
    pack.shotList,
    "",
    "## Music for the edit",
    "",
    pack.musicForEdit,
    "",
    "## Critique checklist",
    "",
    ...pack.checklist.map((item) => `- ${item.blocking ? "[blocking] " : ""}${item.text}`),
    "",
    "## Director's Guide",
    "",
    pack.directorGuide,
    "",
    "## Human review checklist",
    "",
    ...pack.reviewChecklist.map((item) => `- ${item}`),
    "",
    "## AI disclosure",
    "",
    pack.disclosure,
  ].join("\n");
  return { file: `${fileSlug(brand)}-${fileSlug(label)}-production-pack.md`, head, tail };
}

// --- Storyboard ---------------------------------------------------------------------------------------

function newestPerScene<F extends { scene: number; attempt: 1 | 2 }>(frames: readonly F[], concept: Concept): F[] {
  const byScene = new Map<number, F>();
  for (const frame of frames) {
    if (!concept.scenes[frame.scene]) continue;
    const seen = byScene.get(frame.scene);
    if (!seen || frame.attempt > seen.attempt) byScene.set(frame.scene, frame);
  }
  return [...byScene.values()].sort((a, b) => a.scene - b.scene);
}

const frameAlt = (concept: Concept, scene: number) => `Storyboard frame for shot ${scene + 1} (${concept.scenes[scene].beat}): ${concept.scenes[scene].action}`;

export function storyboardView(report: Pick<Report, "trace">, world: World, media: DemoMedia | null | undefined): KitStoryboardView {
  const parts = currentWorld(world);
  const concept = keptConcept(parts);
  const steps = latestJobSteps(report.trace, world.segmentId, "frames");
  // Frames rendered for another pack (an older revision) never sit next to this one.
  const own = world.frames && world.frames.revisionId === parts.revisionId ? world.frames : null;
  const approved = concept && media?.storyboards[world.segmentId] ? newestPerScene(media.storyboards[world.segmentId].frames, concept) : [];
  if (!concept) return { status: "none", reason: null, frames: [], steps, canRequest: false };
  if (own?.status === "done") {
    const frames = newestPerScene(own.frames, concept).map((f) => ({ scene: f.scene, src: f.url, alt: frameAlt(concept, f.scene) }));
    return { status: "done", reason: null, frames, steps, canRequest: frames.length === 0 };
  }
  if (!own && approved.length > 0) {
    return { status: "done", reason: null, frames: approved.map((f) => ({ scene: f.scene, src: f.file, alt: frameAlt(concept, f.scene) })), steps, canRequest: false };
  }
  const status = own?.status ?? "none";
  return { status, reason: own?.reason ?? null, frames: [], steps, canRequest: parts.pack !== null && status !== "rendering" };
}

// --- The view -------------------------------------------------------------------------------------------

function conceptCard(
  world: World,
  ranked: RankedConcept,
  brief: BriefSlots | null,
  ledger: Ledger,
  lead: UgcScript | null,
  kit: Kit | null,
  receipts: Map<string, ReceiptView | null>,
): ConceptCardView {
  const kept = ranked.status === "kept";
  const { concept } = ranked;
  return {
    kind: "concept",
    key: `${world.segmentId}-${kept ? "kept" : fileSlug(concept.title)}`,
    status: kept ? "kept" : "ranked",
    title: concept.title,
    hook: concept.hook,
    emotion: concept.emotion,
    surprise: concept.surpriseBeat,
    testHypothesis: concept.testHypothesis ?? null,
    score: ranked.total,
    formatLabel: kept && lead ? UGC_FORMAT_SPECS[lead.format].label : null,
    platformLabel: kept && lead ? PLATFORM_LABELS[lead.platform] : null,
    ingredients: ingredients(ledger, brief, ranked, receipts),
    copy: kept && lead ? { label: "Copy script", text: lead.script } : { label: "Copy concept", text: conceptText(concept) },
    actorPrompts: kept && lead && kit ? actorPrompts(kit.ugc, lead.platform, lead) : [],
  };
}

function worldView(report: Report, ledger: Ledger, world: World, media: DemoMedia | null | undefined): KitWorldView {
  const parts = currentWorld(world);
  const concept = keptConcept(parts);
  const kit = parts.kit;
  const scripts = kit?.ugc ?? [];
  const revision = parts.revisionId ? world.revisions.find((r) => r.id === parts.revisionId) : undefined;
  const brief = revision?.brief ?? world.brief;
  const brand = report.inputs.product.brandName ?? report.inputs.product.name;
  const platforms = PLATFORMS.filter((p) => scripts.some((s) => s.platform === p));
  const leads = platforms.map((p) => leadFor(scripts, p));
  const cards: KitCardView[] = [];

  const set = parts.concepts;
  const receipts = new Map<string, ReceiptView | null>();
  if (set) {
    cards.push(conceptCard(world, parts.pack ? { ...set.best, concept: parts.pack.concept } : set.best, brief, ledger, leads[0] ?? null, kit, receipts));
    // The other platforms' cuts of the kept concept.
    platforms.slice(1).forEach((platform, i) => {
      const lead = leads[i + 1];
      if (!lead || !concept) return;
      const spec = UGC_FORMAT_SPECS[lead.format];
      cards.push({
        kind: "cut",
        key: `${world.segmentId}-${platform}`,
        platform,
        platformLabel: PLATFORM_LABELS[platform],
        formatLabel: spec.label,
        hookRule: spec.hookType,
        cta: lead.cta,
        conceptTitle: concept.title,
        copy: { label: "Copy script", text: lead.script },
        actorPrompts: actorPrompts(scripts, platform, lead),
      });
    });
    for (const other of set.others.filter((o) => o.status === "ranked")) cards.push(conceptCard(world, other, brief, ledger, null, kit, receipts));
  }
  if (kit?.captions) {
    const lines = captionLines(kit.captions);
    if (lines.length) cards.push({ kind: "captions", key: `${world.segmentId}-captions`, lines, copy: { label: "Copy captions", text: kit.captions } });
  }
  if (kit?.adPlan) {
    const plan = kit.adPlan;
    cards.push({
      kind: "plan",
      key: `${world.segmentId}-plan`,
      name: plan.name,
      ageBands: plan.ageBands.map(ageBandLabel),
      cities: plan.cities,
      watch: plan.watch,
      note: plan.note,
      receipt: receiptView(ledger, plan.evidenceIds, "Ad plan", plan.name),
      copy: { label: "Copy plan", text: planText(world.label, plan) },
    });
  }
  if (kit?.creatorBrief) {
    const cb = kit.creatorBrief;
    cards.push({
      kind: "brief",
      key: `${world.segmentId}-brief`,
      profile: {
        text: cb.profile.text,
        origin: cb.profile.origin,
        receipt: cb.profile.origin === "qloo" || cb.profile.origin === "interpreted" ? receiptView(ledger, cb.profile.evidenceIds, "Creator profile", cb.profile.text) : null,
      },
      hooks: cb.hooks,
      hit: cb.hit,
      avoid: cb.avoid,
      disclosure: cb.disclosure,
      copy: { label: "Copy brief", text: briefText(world.label, cb) },
    });
  }

  return {
    segmentId: world.segmentId,
    label: world.label,
    hook: concept?.hook ?? null,
    testHypothesis: concept?.testHypothesis ?? null,
    scriptCount: scripts.length,
    revisionId: parts.revisionId,
    partial: world.partial,
    cards,
    videoPrompts: parts.pack ? videoPrompts(parts.pack) : [],
    storyboard: storyboardView(report, world, media),
    pack: parts.pack ? packParts(brand, world.label, parts.pack) : null,
  };
}

function adPlanCsv(report: Report): string | null {
  const rows = report.worlds.flatMap((world) => {
    const { kit } = currentWorld(world);
    if (!kit?.adPlan) return [];
    const plan = kit.adPlan;
    const formats = [...new Set(kit.ugc.map((s) => `${UGC_FORMAT_SPECS[s.format].label} (${s.platform === "meta" ? "Meta" : "TikTok"})`))].join("; ");
    return [[world.label, plan.name, plan.ageBands.map(ageBandLabel).join("; "), plan.cities.join("; "), formats, plan.watch, plan.note]];
  });
  if (rows.length === 0) return null;
  return toCsv([["Concept world", "Ad set (Meta) or ad group (TikTok)", "Age bands (optional)", "Cities (optional)", "Creatives", "What to watch", "Note"], ...rows]);
}

function creatorBriefText(report: Report): string | null {
  const briefs = report.worlds.flatMap((world) => {
    const { kit } = currentWorld(world);
    return kit?.creatorBrief ? [briefText(world.label, kit.creatorBrief)] : [];
  });
  if (briefs.length === 0) return null;
  const brand = report.inputs.product.brandName ?? report.inputs.product.name;
  return [`# Creator brief: ${brand}`, "", "One brief per concept world, to hand to a creator you hire. Every script speaks as the brand.", "", briefs.join("\n\n")].join("\n");
}

/**
 * The Campaign Kit. `media` is an example's approved demo media: its storyboard frames show on the
 * kept concept's card (live runs use their own frames).
 */
export function kitView(report: Report, media: DemoMedia | null = null): KitView {
  const ledger = ledgerOf(report);
  const worlds = report.worlds.map((world) => worldView(report, ledger, world, media));
  const brand = fileSlug(report.inputs.product.brandName ?? report.inputs.product.name);
  const csv = adPlanCsv(report);
  const briefs = creatorBriefText(report);
  return {
    worlds,
    counts: {
      worlds: worlds.length,
      concepts: worlds.reduce((n, w) => n + w.cards.filter((c) => c.kind === "concept").length, 0),
      scripts: worlds.reduce((n, w) => n + w.scriptCount, 0),
    },
    downloads: {
      adPlan: csv ? { file: `${brand}-ad-plan.csv`, text: csv } : null,
      creatorBrief: briefs ? { file: `${brand}-creator-brief.md`, text: briefs } : null,
    },
  };
}
