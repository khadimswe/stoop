// The kit's short-form scripts and captions for one world's kept concept. The Creative Director picks
// one format per world from the concept itself (a deterministic rule, no extra LLM call) and says why;
// the format's slots are then filled from the concept's own lines, the brief and the seller's facts.
// Every script goes to Meta and TikTok, for Arcads, Creatify and a human creator.
import { AVOID_LIST_EXEMPT, checkText, FAMOUS_PLACES, formatGuardIssues } from "../../guardrails";
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
  /** The format AI-actor tools get: the same, or the product demo when the format is customer-voice. */
  aiFormat: UgcFormatSpec;
  /** One line for the trace: why this format fits the concept. */
  reason: string;
  /** The words that pointed to it (empty for the product-demo fallback). */
  matched: string[];
}

const AI_TOOLS: ReadonlySet<string> = new Set(["arcads", "creatify"]);

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
  const demo = UGC_FORMAT_SPECS.product_demo;
  if (best) {
    const voice = best.spec.customerVoice
      ? ` It reads as a customer's own experience, so only a human creator gets it; AI-actor tools get the ${demo.label.toLowerCase()} (an AI actor would be a person who does not exist shown using the product).`
      : "";
    return {
      format: best.spec,
      aiFormat: best.spec.customerVoice ? demo : best.spec,
      matched: best.matched,
      reason: `${best.spec.label}: the concept's own words point to it (${best.matched.map((m) => `"${m}"`).join(", ")}). ${best.spec.hookType}${voice}`,
    };
  }
  const used = concept.scenes.filter((scene) => scene.productVisible).length;
  return {
    format: demo,
    aiFormat: demo,
    matched: [],
    reason: `${demo.label}: the product is on screen in ${used} of ${concept.scenes.length} scenes, and no other format's beats show up in the concept.`,
  };
}

/** Arcads' script field: the plan caps the paste-in script under 1,000 characters (Arcads allows about 1,500). */
export const ARCADS_MAX_CHARS = 1000;

/** The seller's one-line description as the proof beat, unless it makes a claim the kit can't use. */
export function proofLine(product: ProductSpec): string | null {
  return checkText(product.oneLine).length === 0 ? product.oneLine : null;
}

function actorAge(brief: BriefSlots): string {
  const bands = brief.segment.ageBands.map(ageBandLabel);
  return bands.length === 1 ? `an adult aged ${bands[0]}` : `an adult in one of these age bands: ${bands.join(", ")}`;
}

/**
 * The format's beats, filled from the concept's scenes and lines (the brand's own words). Every scene
 * keeps its place and its time, so the script runs the full 15 s with no gaps and keeps the concept's
 * cultural and escalation moments: the hook, the demo (where the seller's own line is said), each
 * moment, then the call to action. The presenter is styled from the brief only when the ad has an
 * on-screen person; a pet or product-only brief styles the product, not the presenter.
 */
export function scriptPlan(product: ProductSpec, brief: BriefSlots, concept: Concept, format: UgcFormatSpec): ScriptPlan {
  const spans = timecodes(concept);
  const scenes = concept.scenes.map((scene, index) => ({ scene, ...spans[index] }));
  const hook = scenes[0];
  const middle = scenes.slice(1, -1);
  const demo = middle.find((s) => s.scene.beat === "product") ?? middle.find((s) => s.scene.productVisible) ?? null;
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
  const proof = proofLine(product);
  const beats: ScriptBeat[] = scenes.map((s, index): ScriptBeat => {
    if (index === 0) {
      return {
        beat: "hook",
        start: s.start,
        end: s.end,
        say: once([founderIntro, hookSay].filter(Boolean).join(" ") || null),
        show: sentence(s.scene.action),
        onScreen: onScreenHook ? `${format.textPrefix}${format.textPrefix ? midSentence(onScreenHook) : onScreenHook}` : null,
      };
    }
    if (index === scenes.length - 1) {
      return { beat: "cta", start: s.start, end: s.end, say: once(line(s) ?? sentence(ctaLabelFor(format))), show: sentence(s.scene.action), onScreen: null };
    }
    if (s === demo) {
      const words = [once(line(s)), proof && !said.has(proof) ? once(proof) : null].filter(Boolean).join(" ");
      return { beat: "demo", start: s.start, end: s.end, say: words || null, show: `${sentence(s.scene.action)} ${format.demoBeat}`, onScreen: null };
    }
    return { beat: "moment", start: s.start, end: s.end, say: once(line(s)), show: sentence(s.scene.action), onScreen: null };
  });
  // No product scene in the middle: the seller's line goes with the call to action.
  if (!demo && proof && !said.has(proof)) {
    const cta = beats[beats.length - 1];
    cta.say = [proof, cta.say].filter(Boolean).join(" ");
    said.add(proof);
  }
  return {
    format,
    productName: product.name,
    beats,
    proof: proof && said.has(proof) ? proof : null,
    actorAge: actorAge(brief),
    styling: brief.talent ? (brief.wardrobe?.text ?? null) : null,
    voice: brief.voice.tone.text,
    avoid: brief.voice.avoid,
  };
}

const ctaLabelFor = (format: UgcFormatSpec) => ctaLabel({ format } as ScriptPlan, "meta");

/** The guardrails on everything a script carries from the concept, the brief and the seller. */
function guardPlan(plan: ScriptPlan, product: ProductSpec, brief: BriefSlots, names: readonly string[]): void {
  const options = { names: [...names, ...FAMOUS_PLACES], allowedNames: [...brief.allowedPlaces, ...(product.brandName ? [product.brandName] : [])] };
  const texts = [...plan.beats.flatMap((beat) => [beat.say ?? "", beat.show, beat.onScreen ?? ""]), plan.styling ?? "", plan.voice];
  const issues = texts.flatMap((text) => checkText(text, options));
  // An avoid list names banned claims in order to forbid them.
  const avoid = plan.avoid.flatMap((item) => checkText(item, options).filter((issue) => !AVOID_LIST_EXEMPT.has(issue.rule)));
  if (issues.length + avoid.length > 0) throw new Error(`A kit script breaks the guardrails:\n${formatGuardIssues([...issues, ...avoid])}`);
}

/** Keeps the spoken lines inside Arcads' cap: drops the seller's proof line, then the moment and demo lines, if it must. */
function fitArcads(plan: ScriptPlan): ScriptPlan {
  const spokenLength = (p: ScriptPlan) => p.beats.reduce((sum, beat) => sum + (beat.say ? beat.say.length + 30 : 0), 0);
  let fitted = plan;
  if (spokenLength(fitted) > ARCADS_MAX_CHARS && plan.proof) {
    const proof = plan.proof;
    const strip = (say: string | null) => (say ? say.replace(proof, "").trim() || null : say);
    fitted = { ...fitted, proof: null, beats: fitted.beats.map((beat) => ({ ...beat, say: strip(beat.say) })) };
  }
  for (const drop of ["moment", "demo"] as const) {
    if (spokenLength(fitted) <= ARCADS_MAX_CHARS) break;
    fitted = { ...fitted, beats: fitted.beats.map((beat) => (beat.beat === drop ? { ...beat, say: null } : beat)) };
  }
  if (spokenLength(fitted) > ARCADS_MAX_CHARS) throw new Error(`The Arcads script runs past ${ARCADS_MAX_CHARS} characters even without its proof and demo lines.`);
  return fitted;
}

export interface KitScriptsInput {
  product: ProductSpec;
  brief: BriefSlots;
  concept: Concept;
  /** Real names (references, seeds, Qloo entities) that must never appear in a script, as checkPack takes them. */
  names?: readonly string[];
}

/**
 * The Kit's captions and short-form scripts for one kept concept: Meta and TikTok, for Arcads,
 * Creatify and a human creator. A customer-voice format goes to the creator only; the AI-actor tools
 * get the product demo of the same concept. Zero Qloo and LLM calls.
 */
export function buildKitScripts({ product, brief, concept, names = [] }: KitScriptsInput): { captions: string | null; ugc: UgcScript[] } {
  const pick = pickUgcFormat(concept);
  const plans = new Map([pick.format, pick.aiFormat].map((format) => [format.id, scriptPlan(product, brief, concept, format)] as const));
  for (const plan of plans.values()) guardPlan(plan, product, brief, names);
  const ugc = AD_PLATFORMS.flatMap((platform) =>
    SCRIPT_TOOLS.map((tool) => {
      const plan = plans.get((AI_TOOLS.has(tool) ? pick.aiFormat : pick.format).id) as ScriptPlan;
      const script = SCRIPT_WRITERS[tool](tool === "arcads" ? fitArcads(plan) : plan, platform);
      return ugcScriptSchema.parse({ format: plan.format.id, platform, tool, script, cta: ctaLabel(plan, platform) });
    }),
  );
  return { captions: conceptCaptions(concept), ugc };
}
