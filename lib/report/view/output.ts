// The Output section, per world and for the Control: the storyboard (the concept preview), the video
// line, the copy-ready export and the MCP link. Pure: render jobs live outside the Report, so the page
// passes in what the Render button may do (RenderAccess) and, on examples, the approved demo media.
// Also the brief cues each world's pack carries, with their receipts, which "Your ad" and the
// Screening Room show as chips.
import type { RenderTarget } from "../../api/requests";
import { CONTROL_KEY, type DemoClip, type DemoMedia } from "../../demo/manifest";
import type { BriefSlot, BriefSlots, Concept, Scene } from "../../prompts/brief";
import { frameScenes } from "../../prompts/frames";
import { timecodes } from "../../prompts/lines";
import { CAMERA_PRESETS, getModel, type ModelId } from "../../prompts/models.config";
import { STRONG_SHARE } from "../../data-check/score";
import { contentStems, distinctiveStems } from "../../stages/concepts";
import { strong } from "../../stages/craft";
import type { AssetKind, ProductionPack, RenderJob } from "../../prompts/pack";
import type { CueOrigin, CultureField } from "../../types";
import type { Report } from "../schema";
import type { Control, CultureFieldResult, CultureSource, World, WorldFrames } from "../world";
import { currentControl, currentWorld, keptConcept, type CurrentParts } from "./current";
import { plainType } from "./format";
import { ledgerOf, receiptView, type Ledger } from "./receipts";
import type { ClipView, PartialView, ReceiptRow, ReceiptView } from "./types";

/** One scene of the kept concept, as the shot list shows it. */
export interface ShotView {
  /** Index into the concept's scenes (0-based), as frames and the pack count them. */
  scene: number;
  /** 1-based, for display ("Shot 2"). */
  number: number;
  beat: Scene["beat"];
  seconds: number;
  /** Seconds into the 15 s ad. */
  start: number;
  end: number;
  action: string;
  overlayText: string | null;
  productVisible: boolean;
  /**
   * The brief cues this shot's own words carry, by slot, in the brief's display order: the concept
   * writer's slot check (lib/stages/concepts.ts verifySlots), applied to one shot. Look each up in the
   * output's `cues` for its origin and receipt.
   */
  carries: BriefSlot[];
}

export interface StoryboardFrameView {
  scene: number;
  /** An https URL (a live run's frame) or a /demo/... path (an example's approved frame). */
  src: string;
  alt: string;
  /** 1: the first render; 2: the re-render after the critique. */
  attempt: 1 | 2;
}

/**
 * The concept preview. Frames when they exist, "rendering" while a live job runs, otherwise the
 * kept concept's shot list. Never shown as a failure. "none" only before a concept exists.
 */
export type StoryboardView =
  | { kind: "frames"; source: "live" | "example"; frames: StoryboardFrameView[]; shots: ShotView[] }
  | { kind: "rendering"; shots: ShotView[] }
  /** `paused`: the daily frame cap was reached ("Storyboards paused today"). */
  | { kind: "shots"; shots: ShotView[]; paused: boolean }
  | { kind: "none" };

/**
 * What the Render button may do for this visitor. Render jobs live outside the Report, so the page
 * decides this and passes it in (a static page passes its default; a client component can swap it).
 *   judge        "Render draft video" (judge pass, server-paid drafts)
 *   byok         "Render with your fal key"
 *   budget-used  "Render budget used. Here's the storyboard and the example clip."
 *   off          no render button
 */
export type RenderAccess =
  | { kind: "judge" }
  | { kind: "byok" }
  | { kind: "budget-used"; exampleClip: ClipView | null }
  | { kind: "off" };

/**
 * The Video line. An approved example clip plays first when there is one; the access line follows it
 * either way. `access` is the static default the page passed in: the client swaps it once
 * GET /api/render/access has answered for this visitor (hooks/use-render-access.ts).
 */
export interface VideoView {
  clip: ClipView | null;
  access: RenderAccess;
}

/**
 * One cue of the brief a world's pack was built from, with where it came from. Qloo and interpreted
 * cues carry their receipt (the Qloo picks behind the field, then the calls); creative cues and the
 * whole Control brief carry none.
 */
export interface BriefCueView {
  slot: BriefSlot;
  /** "Music style", "Look", "Setting", ... */
  label: string;
  text: string;
  origin: CueOrigin;
  receipt: ReceiptView | null;
  /** The Qloo picks this cue cites, by name (names live in receipts and chips, never in prompts). */
  picks: string[];
  /** The kept concept verifiably draws on this cue (the concept's verified uses). */
  used: boolean;
}

/** One copy-ready render prompt from the Production Pack. */
export interface PromptView {
  /** The pack's render job id, e.g. "seedance-15s" or "veo-scene-2". */
  id: string;
  modelId: ModelId;
  /** From lib/prompts/models.config.ts; UI code never hardcodes a model name. */
  modelName: string;
  kind: "multi-shot" | "scene";
  /** 1-based scene numbers this prompt renders. */
  scenes: number[];
  /** Length to request from the model, and the length to cut it to in the edit. */
  renderSeconds: number;
  trimTo: number;
  /** Asset filenames (or source photo URLs) to attach as references. */
  refs: string[];
  /** Where an image-to-video job starts, in words, e.g. "loc_seg_a_porch.png". */
  startFrame: string | null;
  prompt: string;
  /** For tools with a separate negative field. */
  negative: string | null;
  promptHash: string;
}

export interface AssetPromptView {
  /** The fixed filename the scene prompts reference, e.g. "product_sheet.png". */
  file: string;
  kind: AssetKind;
  modelName: string;
  aspect: string;
  prompt: string;
  refs: string[];
  negative: string | null;
}

export interface ExportView {
  /** The multi-shot render ("Copy the prompt that made this", Higgsfield). */
  multiShot: PromptView | null;
  /** The per-scene prompts for the Veo family, one per scene. */
  veo: { modelName: string; prompts: PromptView[] } | null;
  /** The rest of the Production Pack, as references. */
  references: {
    /** Asset prompts with their fixed filenames: render these first, the scene prompts point at them. */
    assets: AssetPromptView[];
    /** Other per-scene families the pack also wrote prompts for (in the downloaded kit). */
    otherModels: { modelName: string; prompts: number }[];
    shotList: string;
    directorGuide: string;
    checklist: { id: string; text: string; blocking: boolean }[];
    reviewChecklist: string[];
    disclosure: string;
  };
}

export interface McpLinkView {
  href: "/mcp";
  label: string;
}

/** The Output section for one world, or for the Control (key "control"). */
export interface OutputView {
  /** The world's segment id, or "control". */
  key: string;
  isControl: boolean;
  label: string;
  /** What the render routes and the BYOK page take: this report and this world (or the Control). */
  target: RenderTarget;
  partial: PartialView | null;
  storyboard: StoryboardView;
  video: VideoView;
  /** Null until the world has a Production Pack. */
  export: ExportView | null;
  /** The brief the pack on show was built from, Qloo-backed cues first. Empty before a brief exists. */
  cues: BriefCueView[];
  mcp: McpLinkView;
}

export const MCP_LINK: McpLinkView = { href: "/mcp", label: "Use Stoop inside your Claude" };

export interface OutputOptions {
  /** An example's approved demo media. Omit on live reports. */
  media?: DemoMedia | null;
  renderAccess: RenderAccess;
}

/** What one world's output needs from the rest of the report: its id (the render target) and the ledger (receipts). */
export interface OutputContext extends OutputOptions {
  reportId: string;
  ledger: Ledger;
}

// --- Brief cues ----------------------------------------------------------------------------------

/** Qloo-backed fields first (music leads: it is the judge path's receipt), then the creative slots. */
const SLOT_ORDER: readonly BriefSlot[] = ["music", "visual", "wardrobe", "setting.0", "setting.1", "setting.2", "mood", "voice.tone", "productRole", "talent"];

const SLOT_LABEL: Record<BriefSlot, string> = {
  music: "Music style",
  visual: "Look",
  wardrobe: "Wardrobe",
  "setting.0": "Setting",
  "setting.1": "Setting",
  "setting.2": "Setting",
  mood: "Mood",
  "voice.tone": "Voice",
  productRole: "Product role",
  talent: "Talent",
};

/** The Culture Brief field whose Qloo picks back a slot. Product role and talent have none. */
const SLOT_FIELD: Partial<Record<BriefSlot, CultureField>> = {
  music: "music",
  visual: "visual",
  wardrobe: "wardrobe",
  "setting.0": "setting",
  "setting.1": "setting",
  "setting.2": "setting",
  mood: "mood",
  "voice.tone": "voice",
};

/**
 * The field's signal in the stage's own terms (lib/stages/craft.ts signalOf): rich takes 3 or more
 * strong picks; a pick is strong when it beats at least 75% of its reference panel, or is a setting
 * place Qloo explained. Counted from the field's picks, never asserted.
 */
export function signalRows(field: CultureFieldResult): ReceiptRow[] {
  const picks = field.sources.length;
  const strongPicks = field.sources.filter((s) => strong({ position: s.position, why: s.why, field: field.field })).length;
  const share = `${Math.round(STRONG_SHARE * 100)}%`;
  return [
    { label: "Qloo signal", value: `${field.signal}: ${strongPicks} of ${picks} ${picks === 1 ? "pick" : "picks"} strong (3 or more strong makes a field rich)` },
    { label: "Strong", value: field.field === "setting" ? `beats at least ${share} of its reference panel, or is a place Qloo explained` : `beats at least ${share} of its reference panel` },
  ];
}

/** How many of a field's Qloo picks a receipt names. */
const RECEIPT_PICKS = 4;

/** A reference panel in plain words, for "beats 24 of 24 reference artists". */
export function panelNoun(type: string): string {
  if (type.startsWith("urn:tag:genre")) return "music tags";
  if (type.startsWith("urn:tag:emotional_tone")) return "mood tags";
  if (type.startsWith("urn:tag")) return "tags";
  const plural: Record<string, string> = { movie: "films", tv_show: "TV shows", person: "people" };
  const entity = /^urn:entity:([a-z_]+)$/.exec(type)?.[1];
  return entity ? (plural[entity] ?? `${entity.replace(/_/g, " ")}s`) : "items";
}

/** One Qloo pick behind a cue: its name lives in the receipt, never in a prompt. */
export function pickRow(source: CultureSource): ReceiptRow {
  const facts = [`#${source.rank} in its Qloo response`];
  if (source.position) facts.push(`beats ${source.position.beats} of ${source.position.of} reference ${panelNoun(source.type)}`);
  if (source.why.length > 0) facts.push(`Qloo says: ${source.why.join("; ")}`);
  return { label: "Qloo pick", value: `${source.name} (${plainType(source.type)}): ${facts.join(", ")}` };
}

type CueLike = { text: string; origin: CueOrigin; evidenceIds: readonly string[] };

/** The field's Qloo picks a cue cites (they share a call), in Qloo's order, at most RECEIPT_PICKS. */
export function citedPicks(cue: CueLike, field: CultureFieldResult | null): CultureSource[] {
  if (cue.origin !== "qloo" && cue.origin !== "interpreted") return [];
  const cited = new Set(cue.evidenceIds);
  return (field?.sources ?? []).filter((s) => s.evidenceIds.some((id) => cited.has(id))).slice(0, RECEIPT_PICKS);
}

/**
 * The receipt for one Qloo-backed cue: the field's signal, the picks this cue cites (by shared
 * evidence), then the calls. Null for creative cues and when the cue has no evidence in the ledger.
 */
export function cueReceipt(ledger: Ledger, label: string, cue: CueLike, field: CultureFieldResult | null): ReceiptView | null {
  if (cue.origin !== "qloo" && cue.origin !== "interpreted") return null;
  const calls = receiptView(ledger, cue.evidenceIds, label, cue.text);
  if (!calls) return null;
  const picks = citedPicks(cue, field);
  const head: ReceiptRow[] = [
    { label: "Wording", value: cue.origin === "qloo" ? "Returned by Qloo" : "Stoop's wording of the Qloo picks below" },
  ];
  if (field) head.push(...signalRows(field));
  if (field?.scope === "audience") head.push({ label: "Scope", value: "Measured for the whole taste neighborhood, not only this world" });
  return { ...calls, rows: [...head, ...picks.map(pickRow), ...calls.rows] };
}

function slotCue(brief: BriefSlots, slot: BriefSlot) {
  switch (slot) {
    case "voice.tone":
      return brief.voice.tone;
    case "setting.0":
    case "setting.1":
    case "setting.2":
      return brief.setting[Number(slot.slice(-1))] ?? null;
    default:
      return brief[slot];
  }
}

/**
 * A setting's label: plain "Setting" for the one the concept uses (or the brief's only one), else
 * numbered by its place in the brief ("Setting 2"), so two settings never share a name.
 */
function settingLabel(slot: BriefSlot, brief: BriefSlots, used: ReadonlySet<string>): string {
  const index = Number(slot.slice(-1));
  const usedSettings = brief.setting.map((_, i) => `setting.${i}`).filter((s) => used.has(s));
  if (brief.setting.length === 1) return "Setting";
  if (usedSettings.length === 1 && usedSettings[0] === slot) return "Setting";
  return `Setting ${index + 1}`;
}

/** The brief's cues in display order, each with its origin, its receipt and whether the kept concept uses it. */
export function briefCues(brief: BriefSlots | null, culture: readonly CultureFieldResult[] | null, verifiedUses: readonly string[], ledger: Ledger): BriefCueView[] {
  if (!brief) return [];
  const used = new Set(verifiedUses);
  const fields = new Map((culture ?? []).map((f) => [f.field, f]));
  const cues: BriefCueView[] = [];
  for (const slot of SLOT_ORDER) {
    const cue = slotCue(brief, slot);
    if (!cue) continue;
    const label = slot.startsWith("setting.") ? settingLabel(slot, brief, used) : SLOT_LABEL[slot];
    const key = SLOT_FIELD[slot];
    const field = key ? (fields.get(key) ?? null) : null;
    const receipt = cueReceipt(ledger, label, cue, field);
    cues.push({
      slot,
      label,
      text: cue.text,
      origin: cue.origin,
      receipt,
      picks: receipt ? citedPicks(cue, field).map((s) => s.name) : [],
      used: used.has(slot),
    });
  }
  // Qloo-backed first, keeping the order above within each group.
  const backed = (c: BriefCueView) => c.origin === "qloo" || c.origin === "interpreted";
  return [...cues.filter(backed), ...cues.filter((c) => !backed(c))];
}

/** The brief, culture and kept concept on show: a revision's when one replaced the world's own. */
export function worldBrief(world: World, parts: CurrentParts) {
  const revision = parts.revisionId ? world.revisions.find((r) => r.id === parts.revisionId) : undefined;
  return { brief: revision?.brief ?? world.brief, culture: revision?.culture ?? world.culture };
}

/** One shot's own words, as the concept writer's check reads a concept (its scene fields and its location plate). */
function sceneText(concept: Concept, index: number): string {
  const scene = concept.scenes[index];
  const place = concept.locations.find((l) => l.slug === scene.location);
  return [
    scene.action,
    scene.framing,
    scene.motion,
    scene.lighting,
    scene.location,
    place?.description ?? "",
    place?.timeOfDay ?? "",
    place?.lighting ?? "",
    scene.overlayText ?? "",
    scene.dialogue ?? "",
    scene.sound,
    CAMERA_PRESETS[scene.camera].label,
  ].join("\n");
}

/**
 * Which of the concept's verified brief slots each shot carries: a slot counts for a shot when the
 * shot's own words hold at least min(2, n) of the slot's n distinctive stems, the rule the concept
 * writer's specificity check uses for the whole concept. Only slots the whole concept verified count.
 */
export function shotCarries(concept: Concept, brief: BriefSlots | null, verifiedUses: readonly string[]): BriefSlot[][] {
  if (!brief) return concept.scenes.map(() => []);
  const used = new Set(verifiedUses);
  const distinctive = distinctiveStems(brief);
  const slots = SLOT_ORDER.filter((slot) => used.has(slot) && (distinctive.get(slot)?.size ?? 0) > 0);
  return concept.scenes.map((_, index) => {
    const words = contentStems(sceneText(concept, index));
    return slots.filter((slot) => {
      const stems = [...(distinctive.get(slot) ?? [])];
      return stems.filter((s) => words.has(s)).length >= Math.min(2, stems.length);
    });
  });
}

/** The kept concept's shot list: the scenes a storyboard draws (frameScenes, up to 4), in order. */
export function shotList(concept: Concept, brief: BriefSlots | null = null, verifiedUses: readonly string[] = []): ShotView[] {
  const times = timecodes(concept);
  const carries = shotCarries(concept, brief, verifiedUses);
  return frameScenes(concept.scenes).map((index) => {
    const scene = concept.scenes[index];
    return {
      scene: index,
      number: index + 1,
      beat: scene.beat,
      seconds: scene.seconds,
      start: times[index].start,
      end: times[index].end,
      action: scene.action,
      overlayText: scene.overlayText,
      productVisible: scene.productVisible,
      carries: carries[index],
    };
  });
}

/** The newest attempt of each scene the concept has, in scene order. */
function latestFrames<F extends { scene: number; attempt: 1 | 2 }>(frames: readonly F[], concept: Concept): F[] {
  const byScene = new Map<number, F>();
  for (const frame of frames) {
    if (!concept.scenes[frame.scene]) continue;
    const seen = byScene.get(frame.scene);
    if (!seen || frame.attempt > seen.attempt) byScene.set(frame.scene, frame);
  }
  return [...byScene.values()].sort((a, b) => a.scene - b.scene);
}

function frameView(concept: Concept, scene: number, src: string, attempt: 1 | 2): StoryboardFrameView {
  const { beat, action } = concept.scenes[scene];
  return { scene, src, attempt, alt: `Storyboard frame for shot ${scene + 1} (${beat}): ${action}` };
}

/**
 * Frames when they exist (a live run's finished frames for the pack on show, else an example's
 * approved storyboard), "rendering" while a live job runs, otherwise the shot list.
 */
function storyboardView(parts: CurrentParts, brief: BriefSlots | null, live: WorldFrames | null, example: DemoMedia["storyboards"][string] | undefined): StoryboardView {
  const concept = keptConcept(parts);
  if (!concept) return { kind: "none" };
  const shots = shotList(concept, brief, parts.concepts?.best.verifiedUses ?? []);
  // Frames rendered for another revision's pack never sit next to this one.
  const own = live && live.revisionId === parts.revisionId ? live : null;
  if (own?.status === "done") {
    const frames = latestFrames(own.frames, concept);
    if (frames.length > 0) return { kind: "frames", source: "live", frames: frames.map((f) => frameView(concept, f.scene, f.url, f.attempt)), shots };
  }
  if (own?.status === "rendering") return { kind: "rendering", shots };
  const approved = example ? latestFrames(example.frames, concept) : [];
  if (approved.length > 0) return { kind: "frames", source: "example", frames: approved.map((f) => frameView(concept, f.scene, f.file, f.attempt)), shots };
  return { kind: "shots", shots, paused: own?.status === "paused" };
}

function clipView(clip: DemoClip, label: string): ClipView {
  return { id: clip.id, src: clip.file, poster: clip.poster, captions: clip.captions, label };
}

/** A world's approved culture clip (segment id), or the Control's (null). Hero hook cuts never count. */
export function approvedClip(media: DemoMedia | null | undefined, segmentId: string | null, label: string): ClipView | null {
  const role = segmentId === null ? "control" : "culture";
  const clip = media?.clips.find((c) => c.role === role && c.segmentId === segmentId);
  return clip ? clipView(clip, label) : null;
}

/** An approved example clip for this world (or the Control) plays first; the access line follows. */
function videoView(media: DemoMedia | null | undefined, segmentId: string | null, label: string, access: RenderAccess): VideoView {
  return { clip: approvedClip(media, segmentId, label), access };
}

function startFrameText(job: RenderJob): string | null {
  if (!job.startFrame) return null;
  return job.startFrame.kind === "asset" ? job.startFrame.file : `last frame of ${job.startFrame.job}`;
}

function promptView(job: RenderJob): PromptView {
  return {
    id: job.id,
    modelId: job.modelId,
    modelName: getModel(job.modelId).displayName,
    kind: job.kind,
    scenes: job.sceneIndexes.map((i) => i + 1),
    renderSeconds: job.renderSeconds,
    trimTo: job.trimTo,
    refs: job.refs,
    startFrame: startFrameText(job),
    prompt: job.prompt,
    negative: job.negative,
    promptHash: job.promptHash,
  };
}

/**
 * The copy-ready prompts: the multi-shot render the pack's settings chose (the Higgsfield prompt) and
 * the per-scene prompts of the Veo family, selected by the model ids in models.config. The rest of the
 * pack comes along as references.
 */
export function exportView(pack: ProductionPack): ExportView {
  const multiShot = pack.renders.find((r) => r.kind === "multi-shot" && r.modelId === pack.settings.models.multiShot) ?? null;
  const scenes = pack.renders.filter((r) => r.kind === "scene");
  const veo = scenes.filter((r) => getModel(r.modelId).template === "veo");
  const others = new Map<string, number>();
  for (const job of scenes) {
    if (getModel(job.modelId).template === "veo") continue;
    const name = getModel(job.modelId).displayName;
    others.set(name, (others.get(name) ?? 0) + 1);
  }
  return {
    multiShot: multiShot && promptView(multiShot),
    veo: veo.length > 0 ? { modelName: getModel(veo[0].modelId).displayName, prompts: veo.map(promptView) } : null,
    references: {
      assets: pack.assets.map((a) => ({
        file: a.file,
        kind: a.kind,
        modelName: getModel(a.modelId).displayName,
        aspect: a.aspect,
        prompt: a.prompt,
        refs: a.refs,
        negative: a.negative,
      })),
      otherModels: [...others].map(([modelName, prompts]) => ({ modelName, prompts })),
      shotList: pack.shotList,
      directorGuide: pack.directorGuide,
      checklist: pack.checklist.map(({ id, text, blocking }) => ({ id, text, blocking })),
      reviewChecklist: [...pack.reviewChecklist],
      disclosure: pack.disclosure,
    },
  };
}

/** A world's concept preview, as the Output section shows it (the Screening Room's screens share it). */
export function worldStoryboard(world: World, media: DemoMedia | null | undefined): StoryboardView {
  const parts = currentWorld(world);
  return storyboardView(parts, worldBrief(world, parts).brief, world.frames, media?.storyboards[world.segmentId]);
}

export function controlStoryboard(control: Control, media: DemoMedia | null | undefined): StoryboardView {
  return storyboardView(currentControl(control), control.brief, null, media?.storyboards[CONTROL_KEY]);
}

/** The brief cues of a world's pack on show, with receipts (lib/report/view/screening.ts shares it). */
export function worldCues(world: World, ledger: Ledger): BriefCueView[] {
  const parts = currentWorld(world);
  const { brief, culture } = worldBrief(world, parts);
  return briefCues(brief, culture, parts.concepts?.best.verifiedUses ?? [], ledger);
}

/** The Control's brief: every cue is creative, so none has a receipt. */
export function controlCues(control: Control, ledger: Ledger): BriefCueView[] {
  return briefCues(control.brief, null, control.concepts?.best.verifiedUses ?? [], ledger);
}

export function worldOutput(world: World, { media, renderAccess, reportId, ledger }: OutputContext): OutputView {
  const parts = currentWorld(world);
  return {
    key: world.segmentId,
    isControl: false,
    label: world.label,
    target: { reportId, segment: world.segmentId },
    partial: world.partial,
    storyboard: worldStoryboard(world, media),
    video: videoView(media, world.segmentId, world.label, renderAccess),
    export: parts.pack && exportView(parts.pack),
    cues: worldCues(world, ledger),
    mcp: MCP_LINK,
  };
}

export function controlOutput(control: Control, { media, renderAccess, reportId, ledger }: OutputContext): OutputView {
  const parts = currentControl(control);
  return {
    key: CONTROL_KEY,
    isControl: true,
    label: "Control",
    target: { reportId, segment: CONTROL_KEY },
    partial: control.partial,
    storyboard: controlStoryboard(control, media),
    video: videoView(media, null, "Control", renderAccess),
    export: parts.pack && exportView(parts.pack),
    cues: controlCues(control, ledger),
    mcp: MCP_LINK,
  };
}

/** Every world in segment order, then the Control. */
export function outputViews(report: Pick<Report, "meta" | "ledger" | "worlds" | "control">, options: OutputOptions): OutputView[] {
  const context: OutputContext = { ...options, reportId: report.meta.id, ledger: ledgerOf(report) };
  const worlds = report.worlds.map((world) => worldOutput(world, context));
  return report.control ? [...worlds, controlOutput(report.control, context)] : worlds;
}
