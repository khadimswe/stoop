// "Your ad": the top world's kept concept, its copy-ready prompt and script, and the same storyboard
// the Output section shows for it.
import type { Kit, World } from "../world";
import { currentWorld, keptConcept } from "./current";
import { scriptView } from "./kit";
import type { OutputView, PromptView, ScriptView, StoryboardView } from "./types";

export interface YourAdView {
  segmentId: string;
  worldLabel: string;
  /** The concept, hook and emotion are the Creative Director's (origin `creative`). */
  conceptTitle: string;
  hook: string;
  emotion: string;
  testHypothesis: string | null;
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

/** Null when the run has no world yet, or the top world has no concept yet. */
export function yourAdView(world: World | undefined, output: OutputView | undefined): YourAdView | null {
  if (!world || !output) return null;
  const parts = currentWorld(world);
  const concept = keptConcept(parts);
  if (!concept) return null;
  return {
    segmentId: world.segmentId,
    worldLabel: world.label,
    conceptTitle: concept.title,
    hook: concept.hook,
    emotion: concept.emotion,
    testHypothesis: concept.testHypothesis ?? null,
    prompt: output.export?.multiShot ?? null,
    script: leadScript(parts.kit),
    storyboard: output.storyboard,
  };
}
