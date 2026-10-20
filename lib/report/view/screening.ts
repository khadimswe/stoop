// The Screening Room: the Control once, then one row per world with its measured age skew, the
// setting city and the Qloo cues its ad stands on, each with its receipt. Clips show only when
// approved; until then each screen shows the concept preview (storyboard frames or the first shot).
// Also the theater per row: the shot timeline, the cues behind it and the prompt that made it.
import type { DemoMedia } from "../../demo/manifest";
import { CONTROL_SEGMENT } from "../../api/requests";
import type { BriefSlot, BriefSlots, Concept, Scene } from "../../prompts/brief";
import { timecodes } from "../../prompts/lines";
import { CAMERA_PRESETS } from "../../prompts/models.config";
import type { Report } from "../schema";
import type { Control, World } from "../world";
import { currentControl, currentWorld, keptConcept, type CurrentParts } from "./current";
import { settingNote, skewText } from "./format";
import { approvedClip, controlCues, controlStoryboard, exportView, shotCarries, worldBrief, worldCues, worldStoryboard, type BriefCueView } from "./output";
import { receiptView, type Ledger } from "./receipts";
import type { ClipView, PromptView, ReceiptView, ScriptView, StoryboardView } from "./types";
import { leadScript, listWords } from "./your-ad";

/** How many of a segment's cities a row names. */
const TOP_CITIES = 2;

/** One shot of the kept concept in the theater's timeline, with the cues it carries. */
export interface TheaterShotView {
  number: number;
  beat: Scene["beat"];
  start: number;
  end: number;
  action: string;
  overlayText: string | null;
  /** A spoken line, in the brand's own voice. */
  dialogue: string | null;
  productVisible: boolean;
  /** The camera move: always a creative choice, never Qloo. */
  camera: string;
  /** The brief cues this shot's own words carry (output.ts shotCarries); look each up in the theater's `cues`. */
  carries: BriefSlot[];
}

/** One measured fact about a world, with the receipt behind it ("55 and older skews +0.21"). */
export interface FactView {
  text: string;
  receipt: ReceiptView;
  /** A short line that keeps the fact from reading as a contradiction (the setting city's scope). */
  note: string | null;
}

/** "Why this ad": what the theater shows next to the player. */
export interface TheaterView {
  key: string;
  isControl: boolean;
  label: string;
  /** The world's skew (naming its band), top cities and setting city, each with its receipt; none for the Control. */
  facts: FactView[];
  conceptTitle: string | null;
  hookLine: string | null;
  clip: ClipView | null;
  /** Shared with the Output section's storyboard. */
  storyboard: StoryboardView;
  /** The whole brief behind the ad: Qloo-backed cues first, then the creative ones. */
  cues: BriefCueView[];
  shots: TheaterShotView[];
  /** "Copy the prompt that made this": the multi-shot prompt. */
  prompt: PromptView | null;
  script: ScriptView | null;
}

export interface ScreeningWorldView {
  segmentId: string;
  label: string;
  ageBand: string | null;
  /** "skews +0.21": a relative index, never a share. */
  skewText: string | null;
  skewReceipt: ReceiptView | null;
  /** "Pittsfield, MA and Fort Collins, CO": this segment's top stable cities by lift (its age band's heatmap). */
  topCities: string | null;
  topCitiesReceipt: ReceiptView | null;
  /** The setting city (Qloo heatmap lift), never the cast. */
  settingCity: string | null;
  settingReceipt: ReceiptView | null;
  /** settingNote(): the setting city is the whole neighborhood's pick, not from this world's own list. */
  settingNote: string | null;
  clip: ClipView | null;
  /** The Qloo-backed cues the kept concept uses, for the row's chips. */
  cues: BriefCueView[];
  theater: TheaterView | null;
}

export interface ScreeningView {
  /** The generic clip, shown once and pinned as "Control". Null when the run has no Control. */
  control: { clip: ClipView | null; theater: TheaterView | null } | null;
  worlds: ScreeningWorldView[];
}

/** Every shot of the kept concept (the storyboard draws up to 4), with the cues each one carries. */
export function theaterShots(concept: Concept, brief: BriefSlots | null, verifiedUses: readonly string[]): TheaterShotView[] {
  const times = timecodes(concept);
  const carries = shotCarries(concept, brief, verifiedUses);
  return concept.scenes.map((scene, i) => ({
    number: i + 1,
    beat: scene.beat,
    start: times[i].start,
    end: times[i].end,
    action: scene.action,
    overlayText: scene.overlayText,
    dialogue: scene.dialogue,
    productVisible: scene.productVisible,
    camera: CAMERA_PRESETS[scene.camera].label,
    carries: carries[i],
  }));
}

function theaterView(args: {
  key: string;
  isControl: boolean;
  label: string;
  facts: FactView[];
  parts: CurrentParts;
  brief: BriefSlots | null;
  clip: ClipView | null;
  storyboard: StoryboardView;
  cues: BriefCueView[];
}): TheaterView | null {
  const { parts, brief, ...rest } = args;
  const concept = keptConcept(parts);
  if (!concept) return null;
  return {
    ...rest,
    conceptTitle: concept.title,
    hookLine: concept.scenes[0].overlayText,
    shots: theaterShots(concept, brief, parts.concepts?.best.verifiedUses ?? []),
    prompt: parts.pack ? exportView(parts.pack).multiShot : null,
    script: leadScript(parts.kit),
  };
}

function worldRow(world: World, report: Report, ledger: Ledger, media: DemoMedia | null | undefined): ScreeningWorldView {
  const segment = report.audience.segments?.items.find((s) => s.id === world.segmentId);
  const skew = segment ? skewText(segment.skew) : null;
  const city = world.settingCity;
  const clip = approvedClip(media, world.segmentId, world.label);
  const parts = currentWorld(world);
  const cues = worldCues(world, ledger);
  // A city flagged as swinging between reference sets is left out, as everywhere else.
  const top = (segment?.cities ?? []).filter((c) => c.flags.length === 0).slice(0, TOP_CITIES);
  const topReceipt =
    top.length > 0
      ? receiptView(ledger, [...new Set(top.flatMap((c) => c.evidenceIds))], "Top cities", `${segment!.ageBand}: ${top.map((c) => `${c.label} #${c.rank}`).join(", ")} by lift, ranked against ${top[0].comparedWith} reference audiences`)
      : null;
  const topCities = topReceipt ? listWords(top.map((c) => c.label)) : null;
  const skewReceipt = segment ? receiptView(ledger, segment.evidenceIds, "Age skew", `${segment.ageBand}, ${skew}`) : null;
  const settingReceipt = city ? receiptView(ledger, city.evidenceIds, "Setting city", `${city.label}, #${city.audienceRank} of the taste neighborhood's cities by lift`) : null;
  // No evidence, no display: a fact shows only with its receipt.
  const note = city && settingReceipt ? settingNote(city.audienceRank) : null;
  const facts: FactView[] = [
    segment && skew && skewReceipt ? { text: `${segment.ageBand} ${skew}`, receipt: skewReceipt, note: null } : null,
    topCities && topReceipt ? { text: `top cities by lift: ${topCities}`, receipt: topReceipt, note: null } : null,
    city && settingReceipt ? { text: `set in ${city.label}`, receipt: settingReceipt, note } : null,
  ].filter((fact): fact is FactView => fact !== null);
  return {
    segmentId: world.segmentId,
    label: world.label,
    ageBand: segment?.ageBand ?? null,
    skewText: skew,
    skewReceipt,
    topCities,
    topCitiesReceipt: topReceipt,
    settingCity: city?.label ?? null,
    settingReceipt,
    settingNote: note,
    clip,
    cues: cues.filter((c) => c.used && c.receipt !== null),
    theater: theaterView({
      key: world.segmentId,
      isControl: false,
      label: world.label,
      facts,
      parts,
      brief: worldBrief(world, parts).brief,
      clip,
      storyboard: worldStoryboard(world, media),
      cues,
    }),
  };
}

function controlRow(control: Control, ledger: Ledger, media: DemoMedia | null | undefined): NonNullable<ScreeningView["control"]> {
  const clip = approvedClip(media, null, "Control");
  const parts = currentControl(control);
  return {
    clip,
    theater: theaterView({
      key: CONTROL_SEGMENT,
      isControl: true,
      label: "Control",
      facts: [],
      parts,
      brief: control.brief,
      clip,
      storyboard: controlStoryboard(control, media),
      cues: controlCues(control, ledger),
    }),
  };
}

/** Each screen shows the same concept preview as the Output section's storyboard for that world. */
export function screeningView(report: Report, ledger: Ledger, media: DemoMedia | null | undefined): ScreeningView {
  return {
    control: report.control ? controlRow(report.control, ledger, media) : null,
    worlds: report.worlds.map((world) => worldRow(world, report, ledger, media)),
  };
}
