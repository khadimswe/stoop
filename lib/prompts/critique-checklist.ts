// What a storyboard frame or a rendered clip must pass before anyone uses it. Claude reviews frames
// against this list with vision on live runs, and the Director's Guide prints it for the founder's
// offline renders, so both judge takes by the same written standard. The human review list and the AI
// disclosure note close every Production Pack: nothing auto-publishes.
import type { Cast } from "../types";

export const CHECKLIST_STAGES = ["frame", "clip"] as const;
export type ChecklistStage = (typeof CHECKLIST_STAGES)[number];

/** When an item applies: always, only with on-screen talent, only with seller photos, or only for pet casts. */
export const CHECKLIST_CONDITIONS = ["always", "talent", "source-images", "pet"] as const;
export type ChecklistCondition = (typeof CHECKLIST_CONDITIONS)[number];

export interface ChecklistItem {
  id: string;
  text: string;
  appliesTo: readonly ChecklistStage[];
  /** A blocking item fails the take outright; a non-blocking one is a reason to prefer another take. */
  blocking: boolean;
  when: ChecklistCondition;
}

const BOTH = ["frame", "clip"] as const;
const CLIP = ["clip"] as const;

export const CRITIQUE_CHECKLIST: readonly ChecklistItem[] = [
  { id: "hook", text: "The hook lands in the first 1 to 2 seconds, with no dead air.", appliesTo: CLIP, blocking: true, when: "always" },
  { id: "product-hero", text: "The product is clearly visible and is the hero.", appliesTo: BOTH, blocking: true, when: "always" },
  {
    id: "renderable-staging",
    text: "The staging is one the model renders well: the product is still or moves simply, hands stay off the label, and there are no close-up label words or messy pours.",
    appliesTo: BOTH,
    blocking: false,
    when: "always",
  },
  { id: "tight-framing", text: "Framing is tight enough for reactions to read.", appliesTo: BOTH, blocking: false, when: "talent" },
  {
    id: "continuity",
    text: "The product, any talent and the location stay continuous across scenes.",
    appliesTo: CLIP,
    blocking: true,
    when: "always",
  },
  { id: "eyeline", text: "Eyes track the product before any reaction.", appliesTo: CLIP, blocking: false, when: "talent" },
  {
    id: "no-artifacts",
    text: "No unintended artifacts: extra limbs, warped hands, stray or readable text, watermark glitches, or logos other than the product's own.",
    appliesTo: BOTH,
    blocking: true,
    when: "always",
  },
  {
    id: "real-animals",
    text: "No talking animals, and animals behave like real animals.",
    appliesTo: BOTH,
    blocking: true,
    when: "pet",
  },
  { id: "surprise-beat", text: "There is at least one surprise or escalation beat.", appliesTo: CLIP, blocking: false, when: "always" },
  { id: "tone", text: "The tone matches the brief, with no stereotype.", appliesTo: BOTH, blocking: true, when: "always" },
  { id: "adults-only", text: "Every person reads clearly as an adult.", appliesTo: BOTH, blocking: true, when: "talent" },
  { id: "no-likeness", text: "No person resembles a real celebrity or public figure.", appliesTo: BOTH, blocking: true, when: "talent" },
  {
    id: "matches-source",
    text: "The product matches the source photos: same colors, prints and logo placement.",
    appliesTo: BOTH,
    blocking: true,
    when: "source-images",
  },
];

export interface ChecklistContext {
  /** True when any scene shows a person (fictional adults only). */
  hasTalent: boolean;
  /** True when the seller supplied product photos used as references. */
  hasSourceImages: boolean;
  cast: Cast;
}

/** The checklist items that apply to one pack. */
export function checklistFor(ctx: ChecklistContext): ChecklistItem[] {
  const applies: Record<ChecklistCondition, boolean> = {
    always: true,
    talent: ctx.hasTalent,
    "source-images": ctx.hasSourceImages,
    pet: ctx.cast === "pet",
  };
  return CRITIQUE_CHECKLIST.filter((item) => applies[item.when]);
}

/** A person checks every item before anything is posted. */
export const HUMAN_REVIEW_CHECKLIST: readonly string[] = [
  "Watch every clip end to end before posting.",
  "Every claim is a fact the seller supplied: no invented ratings, sales counts or \"sold out\".",
  "No health claims and no \"FDA approved\" claims.",
  "No real person, celebrity likeness or third-party logo appears.",
  "Music is the model's own or a properly licensed track: no unlicensed songs and no artist sound-alikes.",
  "Turn on TikTok's AI-generated content label when posting.",
  "Use Meta's AI label where it applies.",
  "Creator posts carry #ad or a paid-partnership label (FTC).",
  "Keep any watermark or provenance mark the video tool adds.",
  "A person posts it. Nothing auto-publishes.",
];

export const AI_DISCLOSURE_NOTE =
  "This ad was made with AI video tools from a Stoop Production Pack. " +
  "Label it as AI-generated wherever a platform or the law requires it, and keep any provenance mark the video tool adds.";
