// The Output section, per world and for the Control: the storyboard (the concept preview), the video
// line, the copy-ready export and the MCP link. Pure: render jobs live outside the Report, so the page
// passes in what the Render button may do (RenderAccess) and, on examples, the approved demo media.
import { CONTROL_KEY, type DemoClip, type DemoMedia } from "../../demo/manifest";
import type { Concept, Scene } from "../../prompts/brief";
import { frameScenes } from "../../prompts/frames";
import { timecodes } from "../../prompts/lines";
import { getModel, type ModelId } from "../../prompts/models.config";
import type { AssetKind, ProductionPack, RenderJob } from "../../prompts/pack";
import type { Report } from "../schema";
import type { Control, World, WorldFrames } from "../world";
import { currentControl, currentWorld, keptConcept, type CurrentParts } from "./current";
import type { ClipView, PartialView } from "./types";

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

/** An approved clip for this world wins; otherwise the render access the page passed in. */
export type VideoView = { kind: "clip"; clip: ClipView } | RenderAccess;

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
  partial: PartialView | null;
  storyboard: StoryboardView;
  video: VideoView;
  /** Null until the world has a Production Pack. */
  export: ExportView | null;
  mcp: McpLinkView;
}

export const MCP_LINK: McpLinkView = { href: "/mcp", label: "Use Stoop inside your Claude" };

export interface OutputOptions {
  /** An example's approved demo media. Omit on live reports. */
  media?: DemoMedia | null;
  renderAccess: RenderAccess;
}

/** The kept concept's shot list: the scenes a storyboard draws (frameScenes, up to 4), in order. */
export function shotList(concept: Concept): ShotView[] {
  const times = timecodes(concept);
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
function storyboardView(parts: CurrentParts, live: WorldFrames | null, example: DemoMedia["storyboards"][string] | undefined): StoryboardView {
  const concept = keptConcept(parts);
  if (!concept) return { kind: "none" };
  const shots = shotList(concept);
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

/** An approved example clip for this world (or the Control) wins; otherwise what the page allows. */
function videoView(media: DemoMedia | null | undefined, segmentId: string | null, label: string, access: RenderAccess): VideoView {
  const clip = approvedClip(media, segmentId, label);
  return clip ? { kind: "clip", clip } : access;
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

export function worldOutput(world: World, { media, renderAccess }: OutputOptions): OutputView {
  const parts = currentWorld(world);
  return {
    key: world.segmentId,
    isControl: false,
    label: world.label,
    partial: world.partial,
    storyboard: storyboardView(parts, world.frames, media?.storyboards[world.segmentId]),
    video: videoView(media, world.segmentId, world.label, renderAccess),
    export: parts.pack && exportView(parts.pack),
    mcp: MCP_LINK,
  };
}

export function controlOutput(control: Control, { media, renderAccess }: OutputOptions): OutputView {
  const parts = currentControl(control);
  return {
    key: CONTROL_KEY,
    isControl: true,
    label: "Control",
    partial: control.partial,
    storyboard: storyboardView(parts, null, media?.storyboards[CONTROL_KEY]),
    video: videoView(media, null, "Control", renderAccess),
    export: parts.pack && exportView(parts.pack),
    mcp: MCP_LINK,
  };
}

/** Every world in segment order, then the Control. */
export function outputViews(report: Pick<Report, "worlds" | "control">, options: OutputOptions): OutputView[] {
  const worlds = report.worlds.map((world) => worldOutput(world, options));
  return report.control ? [...worlds, controlOutput(report.control, options)] : worlds;
}
