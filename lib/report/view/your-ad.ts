// "Your ad": the top world's kept concept, its copy-ready prompt and script, the same storyboard the
// Output section shows for it, and one sentence on why it fits, with the Qloo cues it stands on.
import type { Kit, World } from "../world";
import { currentWorld, keptConcept } from "./current";
import { scriptView } from "./kit";
import type { BriefCueView } from "./output";
import type { ClipView, OutputView, PromptView, ReceiptRow, ReceiptView, ScriptView, StoryboardView } from "./types";

export interface YourAdView {
  segmentId: string;
  worldLabel: string;
  /** The concept, hook and emotion are the Creative Director's (origin `creative`). */
  conceptTitle: string;
  hook: string;
  emotion: string;
  testHypothesis: string | null;
  /** The on-screen line of the first shot, the hook in the audience's words; null when the shot has none. */
  hookLine: string | null;
  /** What the first shot shows, for the concept preview. */
  opening: string;
  /** "Music style, look and wardrobe come from what Qloo measured for this world, set in ...". Null without Qloo cues. */
  whyItFits: string | null;
  /** The cues the kept concept uses: Qloo-backed ones (with receipts) first, then the creative ones. */
  cues: BriefCueView[];
  /** "See the receipts": every Qloo call behind those cues, one row per cue. */
  receipt: ReceiptView | null;
  /** An approved example clip for this world, shown with frame 1 as its poster. */
  clip: ClipView | null;
  /** "Copy prompt": the multi-shot prompt. */
  prompt: PromptView | null;
  /** "Copy script": the creator script for Meta when there is one. */
  script: ScriptView | null;
  storyboard: StoryboardView;
}

/** The creator script for Meta when the kit has one, else its first script. */
export function leadScript(kit: Kit | null): ScriptView | null {
  if (!kit) return null;
  const script = kit.ugc.find((s) => s.tool === "creator" && s.platform === "meta") ?? kit.ugc[0];
  return script ? scriptView(script) : null;
}

const qlooBacked = (cue: BriefCueView) => cue.receipt !== null && (cue.origin === "qloo" || cue.origin === "interpreted");

/** "a, b and c". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/**
 * One sentence on why the ad fits, built only from what the data says: the Qloo-backed cues the
 * concept verifiably uses, and the setting city with its rank by lift among the whole taste
 * neighborhood's cities (Prove ranks cities for the audience, not per world). Null when the concept
 * uses no Qloo-backed cue (it then reads as a creative concept, nothing more).
 */
export function whyItFits(cues: readonly BriefCueView[], city: { label: string; audienceRank: number } | null): string | null {
  const labels = [...new Set(cues.filter((c) => c.used && qlooBacked(c)).map((c) => c.label.replace(/ \d$/, "").toLowerCase()))];
  if (labels.length === 0) return null;
  const list = listWords(labels);
  const head = `${list.charAt(0).toUpperCase()}${list.slice(1)} ${labels.length === 1 ? "comes" : "come"} from what Qloo measured for this world`;
  return city ? `${head}, set in ${city.label}, #${city.audienceRank} of the taste neighborhood's cities by lift.` : `${head}.`;
}

/** One row per Qloo-backed cue: the picks it names and how many calls back it. */
export function cuesReceipt(cues: readonly BriefCueView[], title: string): ReceiptView | null {
  const backed = cues.filter(qlooBacked);
  if (backed.length === 0) return null;
  const rows: ReceiptRow[] = backed.map((cue) => {
    const { picks } = cue;
    const calls = `${cue.receipt!.calls} Qloo ${cue.receipt!.calls === 1 ? "call" : "calls"}`;
    return { label: cue.label, value: picks.length > 0 ? `${picks.join(", ")} · ${calls}` : calls };
  });
  const calls = backed.reduce((sum, cue) => sum + cue.receipt!.calls, 0);
  return { cue: "Your ad", title, rows, calls, note: "Each cue's chip opens its own receipt, with the exact Qloo query. API key never shown." };
}

/** Null when the run has no world yet, or the top world has no concept yet. */
export function yourAdView(world: World | undefined, output: OutputView | undefined): YourAdView | null {
  if (!world || !output) return null;
  const parts = currentWorld(world);
  const concept = keptConcept(parts);
  if (!concept) return null;
  const used = output.cues.filter((c) => c.used);
  const first = concept.scenes[0];
  return {
    segmentId: world.segmentId,
    worldLabel: world.label,
    conceptTitle: concept.title,
    hook: concept.hook,
    emotion: concept.emotion,
    testHypothesis: concept.testHypothesis ?? null,
    hookLine: first.overlayText,
    opening: first.action,
    whyItFits: whyItFits(used, world.settingCity),
    cues: used,
    receipt: cuesReceipt(used, `The Qloo data behind "${concept.title}"`),
    clip: output.video.clip,
    prompt: output.export?.multiShot ?? null,
    script: leadScript(parts.kit),
    storyboard: output.storyboard,
  };
}
