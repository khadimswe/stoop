// Script exports for the short-form formats: one for each AI UGC-actor tool (Arcads, Creatify) and one
// for a human creator. Every script speaks as the brand: the AI actor or creator reads the brand's own
// lines and never presents them as a customer's review (FTC rule on consumer reviews and testimonials,
// Aug 2024). Actor briefs describe age band, styling and voice only, never race or ethnicity. Proof
// lines are the seller's own words, never invented ratings, sales counts or "sold out".
//
// Sources (read Oct 16, 2026):
//   Arcads: https://help.arcads.ai/en/articles/13281882-how-to-show-a-product-in-a-video (generate the
//     actor holding the product from the product image as a reference; the script goes under "what the
//     actor should say", up to about 1,500 characters), https://help.arcads.ai/en/articles/9099813-pronunciation-guide
//     ("Wrap each sentence in quotes"; precise pauses with <break time="1.5s" />, 0 to 3 s), and
//     https://help.arcads.ai/en/articles/13239650-how-to-create-a-talking-actor-video-no-product
//     ("Break it into sections for a smoother flow")
//   Creatify: https://docs.creatify.ai/faq (AI Avatar v2 structures a video "as a sequence of scenes",
//     each with its own script) and https://docs.creatify.ai/api-reference/lipsyncs/post-apilipsyncs
//     (voiceover text up to 8,000 characters; aspect ratio 16x9, 1x1 or 9x16)
//   Creator disclosure: https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers
//     (disclose in the video itself, not only in the description; "ad" or "#ad" works; don't rely on
//     a platform's disclosure tool alone; audio and on-screen disclosure together are noticed more)
import type { AD_PLATFORMS, SCRIPT_TOOLS } from "../../report/world";
import { fragment } from "../lines";
import { CTA_LABELS, type UgcFormatSpec } from "./formats";

export type Platform = (typeof AD_PLATFORMS)[number];
export type ScriptTool = (typeof SCRIPT_TOOLS)[number];

/** One beat of a script: what is said (the brand's words, or nothing) and what is shown. */
export interface ScriptBeat {
  beat: "hook" | "demo" | "proof" | "cta";
  start: number;
  end: number;
  say: string | null;
  show: string;
  onScreen: string | null;
}

/** Everything a script needs, already decided: the format, the beats and the people in it. */
export interface ScriptPlan {
  format: UgcFormatSpec;
  productName: string;
  beats: ScriptBeat[];
  /** "an adult in one of these age bands: 25 to 29, 30 to 34". */
  actorAge: string;
  styling: string | null;
  voice: string;
  avoid: readonly string[];
}

const PLATFORM_NAMES: Record<Platform, string> = { meta: "Meta Reels and Stories", tiktok: "TikTok" };
const AI_LABEL: Record<Platform, string> = {
  meta: "Before posting: add Meta's AI label where it applies.",
  tiktok: "Before posting: turn on TikTok's AI-generated content label.",
};

export const ctaLabel = (plan: ScriptPlan, platform: Platform) => CTA_LABELS[plan.format.cta][platform];

const quote = (text: string) => `"${text.replace(/"/g, "'")}"`;
const span = (beat: ScriptBeat) => `${beat.start} to ${beat.end} s`;

function header(plan: ScriptPlan, platform: Platform, title: string): string[] {
  return [
    title,
    `Format: ${plan.format.label} (${plan.format.family === "tiktok" ? "TikTok hook" : "Meta-friendly"}). Platform: ${PLATFORM_NAMES[platform]}. Vertical 9:16, about 15 s.`,
    `Hook: ${plan.format.hookType}`,
  ];
}

function actorLines(plan: ScriptPlan, who: string): string[] {
  return [
    `${who}: an original AI actor, ${plan.actorAge}${plan.styling ? `, styled as: ${fragment(plan.styling)}` : ""}.`,
    `Voice: ${fragment(plan.voice)}. The actor speaks for the brand and plays a part in the brand's ad, never a customer giving a review.`,
  ];
}

/** Arcads: one spoken block, each sentence in quotes, short breaks between sections. */
export function arcadsScript(plan: ScriptPlan, platform: Platform): string {
  const spoken = plan.beats.filter((beat) => beat.say).map((beat) => quote(beat.say as string));
  const hook = plan.beats.find((beat) => beat.onScreen);
  return [
    ...header(plan, platform, "ARCADS SCRIPT"),
    ...actorLines(plan, "Actor"),
    `Product: generate the actor holding the ${plan.productName}, with the product image (product_sheet.png, or the brand's own product photo) as the reference image. ${plan.format.demoBeat}`,
    "",
    "What the actor should say:",
    spoken.join(' <break time="0.5s" />\n'),
    "",
    ...(hook?.onScreen ? [`On-screen text, added in the edit: ${quote(hook.onScreen)}`] : []),
    `CTA button: ${ctaLabel(plan, platform)}`,
    AI_LABEL[platform],
  ].join("\n");
}

/** Creatify: one scene per beat, each with its own script and visual. */
export function creatifyScript(plan: ScriptPlan, platform: Platform): string {
  return [
    ...header(plan, platform, "CREATIFY SCRIPT (AI Avatar, one scene per beat, aspect ratio 9x16)"),
    ...actorLines(plan, "Avatar"),
    "",
    ...plan.beats.map(
      (beat, index) =>
        `Scene ${index + 1} (${beat.beat}, ${span(beat)}). Script: ${beat.say ? quote(beat.say) : "(no line, visual only)"} Visual: ${beat.show}${beat.onScreen ? ` On-screen text: ${quote(beat.onScreen)}` : ""}`,
    ),
    "",
    `CTA button: ${ctaLabel(plan, platform)}`,
    AI_LABEL[platform],
  ].join("\n");
}

/** A human creator: a shot list with the brand's lines and the disclosure rules. */
export function creatorScript(plan: ScriptPlan, platform: Platform): string {
  return [
    ...header(plan, platform, "CREATOR SCRIPT"),
    "These are the brand's lines. Read them as the brand's paid partner: present them as the brand's words, not as your own review, and claim only what the brand states here.",
    `On camera: ${plan.actorAge}${plan.styling ? `, styled as: ${fragment(plan.styling)}` : ""}. Voice: ${fragment(plan.voice)}.`,
    "",
    "Shot list:",
    ...plan.beats.map(
      (beat, index) =>
        `${index + 1}. ${span(beat)}, ${beat.beat}: ${beat.show}${beat.say ? ` Say: ${quote(beat.say)}` : ""}${beat.onScreen ? ` On screen: ${quote(beat.onScreen)}` : ""}`,
    ),
    "",
    ...(plan.avoid.length ? [`Stay away from: ${plan.avoid.join("; ")}.`] : []),
    `CTA button: ${ctaLabel(plan, platform)}`,
    "Disclosure (FTC): say and show \"ad\" in the video itself (#ad works), and also turn on the platform's paid-partnership label; the label alone is not enough.",
  ].join("\n");
}

export const SCRIPT_WRITERS: Readonly<Record<ScriptTool, (plan: ScriptPlan, platform: Platform) => string>> = {
  arcads: arcadsScript,
  creatify: creatifyScript,
  creator: creatorScript,
};
