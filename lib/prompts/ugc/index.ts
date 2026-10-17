// The kit's short-form scripts and captions for one world's kept concept. The Creative Director picks
// one format per world from the concept itself (a deterministic rule, no extra LLM call) and says why;
// the format's slots are then filled from the concept's own lines, the brief and the seller's facts.
// Every script goes to Meta and TikTok, for Arcads, Creatify and a human creator.
import { AVOID_LIST_EXEMPT, checkText, formatGuardIssues } from "../../guardrails";
import { ugcScriptSchema, AD_PLATFORMS, SCRIPT_TOOLS, type UgcScript } from "../../report/world";
import { ageBandLabel } from "../../types";
import type { BriefSlots, Concept, ProductSpec } from "../brief";
import { CAMERA_PRESETS } from "../models.config";
import { midSentence, sentence, timecodes } from "../lines";
import { conceptCaptions } from "./captions";
import { FORMAT_TIE_ORDER, UGC_FORMAT_SPECS, type UgcFormatSpec } from "./formats";
import { ctaLabel, SCRIPT_WRITERS, type ScriptBeat, type ScriptPlan } from "./scripts";

export { conceptCaptions } from "./captions";
export { CTA_LABELS, UGC_FORMAT_SPECS } from "./formats";

export interface FormatPick {
  format: UgcFormatSpec;
  /** One line for the trace: why this format fits the concept. */
  reason: string;
  /** The words that pointed to it (empty for the product-demo fallback). */
  matched: string[];
}

/**
 * Picks one format from the kept concept. Each format lists signal words; a match in the hook scene
 * (its action, overlay or line) or in the concept's hook counts 2, a match elsewhere in the concept
 * counts 1. A format needs a score of 2 or more to win, ties go to FORMAT_TIE_ORDER, and with no
 * winner the concept is a product demo (the product used on screen).
 */
export function pickUgcFormat(concept: Concept): FormatPick {
  const first = concept.scenes[0];
  const hookText = [concept.hook, first.action, first.overlayText ?? "", first.dialogue ?? "", CAMERA_PRESETS[first.camera].label].join("\n").toLowerCase();
  const restText = [
    concept.emotion,
    concept.surpriseBeat,
    ...concept.scenes.slice(1).flatMap((scene) => [scene.action, scene.overlayText ?? "", scene.dialogue ?? "", CAMERA_PRESETS[scene.camera].label]),
  ]
    .join("\n")
    .toLowerCase();
  let best: { spec: UgcFormatSpec; score: number; matched: string[] } | null = null;
  for (const id of FORMAT_TIE_ORDER) {
    const spec = UGC_FORMAT_SPECS[id];
    let score = 0;
    const matched: string[] = [];
    for (const signal of spec.signals) {
      const inHook = signal.exec(hookText)?.[0];
      const inRest = signal.exec(restText)?.[0];
      if (inHook) score += 2;
      else if (inRest) score += 1;
      const word = inHook ?? inRest;
      if (word && !matched.includes(word)) matched.push(word);
    }
    if (score >= 2 && (best === null || score > best.score)) best = { spec, score, matched };
  }
  if (best) {
    return {
      format: best.spec,
      matched: best.matched,
      reason: `${best.spec.label}: the concept's own words point to it (${best.matched.map((m) => `"${m}"`).join(", ")}). ${best.spec.hookType}`,
    };
  }
  const used = concept.scenes.filter((scene) => scene.productVisible).length;
  const demo = UGC_FORMAT_SPECS.product_demo;
  return { format: demo, matched: [], reason: `${demo.label}: the product is on screen in ${used} of ${concept.scenes.length} scenes, and no other format's beats show up in the concept.` };
}

/** The seller's one-line description as the proof beat, unless it makes a claim the kit can't use. */
export function proofLine(product: ProductSpec): string | null {
  return checkText(product.oneLine).length === 0 ? product.oneLine : null;
}

function actorAge(brief: BriefSlots): string {
  const bands = brief.segment.ageBands.map(ageBandLabel);
  return bands.length === 1 ? `an adult aged ${bands[0]}` : `an adult in one of these age bands: ${bands.join(", ")}`;
}

/** The format's beats, filled from the concept's scenes and lines (the brand's own words). */
export function scriptPlan(product: ProductSpec, brief: BriefSlots, concept: Concept, format: UgcFormatSpec): ScriptPlan {
  const spans = timecodes(concept);
  const scenes = concept.scenes.map((scene, index) => ({ scene, ...spans[index] }));
  const hook = scenes[0];
  const payoff = scenes[scenes.length - 1];
  const middle = scenes.slice(1, -1);
  const demo = middle.find((s) => s.scene.beat === "product") ?? middle.find((s) => s.scene.productVisible) ?? middle[0] ?? hook;
  const proofScene = middle.find((s) => s !== demo && (s.scene.beat === "cultural" || s.scene.beat === "escalation")) ?? demo;
  const line = (s: (typeof scenes)[number]) => s.scene.dialogue ?? s.scene.overlayText;

  const hookSay = line(hook) ?? brief.hooks[0]?.text ?? null;
  const founderIntro = format.id === "founder_story" ? `We make ${product.brandName ? `${product.brandName} ` : "this "}${product.name}.` : null;
  const onScreenHook = hook.scene.overlayText ?? hookSay;
  const said = new Set<string>();
  const once = (text: string | null) => {
    if (!text || said.has(text)) return null;
    said.add(text);
    return text;
  };
  const beats: ScriptBeat[] = [
    {
      beat: "hook",
      start: hook.start,
      end: hook.end,
      say: once([founderIntro, hookSay].filter(Boolean).join(" ") || null),
      show: sentence(hook.scene.action),
      onScreen: onScreenHook ? `${format.textPrefix}${format.textPrefix ? midSentence(onScreenHook) : onScreenHook}` : null,
    },
    { beat: "demo", start: demo.start, end: demo.end, say: demo === hook ? null : once(line(demo)), show: `${sentence(demo.scene.action)} ${format.demoBeat}`, onScreen: null },
    { beat: "proof", start: proofScene.start, end: proofScene.end, say: once(proofLine(product)), show: `The ${product.name} up close, label to camera.`, onScreen: null },
    { beat: "cta", start: payoff.start, end: payoff.end, say: once(line(payoff) ?? `${sentence(ctaLabelFor(format))}`), show: sentence(payoff.scene.action), onScreen: null },
  ];
  return {
    format,
    productName: product.name,
    beats,
    actorAge: actorAge(brief),
    styling: brief.wardrobe?.text ?? null,
    voice: brief.voice.tone.text,
    avoid: brief.voice.avoid,
  };
}

const ctaLabelFor = (format: UgcFormatSpec) => ctaLabel({ format } as ScriptPlan, "meta");

/** The guardrails on everything a script carries from the concept, the brief and the seller. */
function guardPlan(plan: ScriptPlan): void {
  const texts = [...plan.beats.flatMap((beat) => [beat.say ?? "", beat.show, beat.onScreen ?? ""]), plan.styling ?? "", plan.voice];
  const issues = texts.flatMap((text) => checkText(text));
  // An avoid list names banned claims in order to forbid them.
  const avoid = plan.avoid.flatMap((item) => checkText(item).filter((issue) => !AVOID_LIST_EXEMPT.has(issue.rule)));
  if (issues.length + avoid.length > 0) throw new Error(`A kit script breaks the guardrails:\n${formatGuardIssues([...issues, ...avoid])}`);
}

export interface KitScriptsInput {
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
}

/** The Kit's captions and short-form scripts for one kept concept. Zero Qloo and LLM calls. */
export function buildKitScripts({ product, brief, concept }: KitScriptsInput): { captions: string | null; ugc: UgcScript[] } {
  const { format } = pickUgcFormat(concept);
  const plan = scriptPlan(product, brief, concept, format);
  guardPlan(plan);
  const ugc = AD_PLATFORMS.flatMap((platform) =>
    SCRIPT_TOOLS.map((tool) => ugcScriptSchema.parse({ format: format.id, platform, tool, script: SCRIPT_WRITERS[tool](plan, platform), cta: ctaLabel(plan, platform) })),
  );
  return { captions: conceptCaptions(concept), ugc };
}
