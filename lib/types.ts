// Core types shared by the pipeline stages, the prompt templates and the UI.
// Origins say where a cue came from; the UI always pairs each one with an icon and a text label.
import { z } from "zod";
import { AGE_BUCKETS, type AgeBucket } from "./qloo/constants";

/**
 * Where a creative cue came from.
 *   qloo         Qloo returned it for this audience
 *   interpreted  LLM wording that cites Qloo items (tempo, camera and lens are never higher than this)
 *   creative     Not from Qloo: a creative suggestion, or anything in the LLM-only Control brief
 *   yours        The user chose it (creative direction or an edited cue)
 */
export const CUE_ORIGINS = ["qloo", "interpreted", "creative", "yours"] as const;
export type CueOrigin = (typeof CUE_ORIGINS)[number];

/** How much Qloo evidence backs a brief field. Thresholds are calibrated against real data. */
export const SIGNALS = ["rich", "thin", "none"] as const;
export type Signal = (typeof SIGNALS)[number];

export const cueSchema = z.strictObject({
  text: z.string().trim().min(1),
  origin: z.enum(CUE_ORIGINS),
  /** Ledger ids of the Qloo calls behind this cue. Empty for creative and yours. */
  evidenceIds: z.array(z.string().min(1)),
});
export type Cue = z.infer<typeof cueSchema>;

/** Qloo's youngest bucket includes minors, so Stoop always shows it as 18 to 24. */
export function ageBandLabel(bucket: AgeBucket): string {
  const labels: Record<AgeBucket, string> = {
    "24_and_younger": "18 to 24",
    "25_to_29": "25 to 29",
    "30_to_34": "30 to 34",
    "35_to_44": "35 to 44",
    "45_to_54": "45 to 54",
    "55_and_older": "55 and older",
  };
  return labels[bucket];
}
export const ageBucketSchema = z.enum(AGE_BUCKETS);

/**
 * Optional creative direction from the user. It belongs to the pack settings, so the Control and
 * the culture-made packs always share it and only the brief differs between them.
 */
export const LOOKS = ["auto", "live_action", "animation_2d", "animation_3d", "stop_motion", "illustrated"] as const;
export type Look = (typeof LOOKS)[number];
export const CASTS = ["auto", "adult_talent", "product_only", "pet"] as const;
export type Cast = (typeof CASTS)[number];
export const ENERGIES = ["auto", "calm", "upbeat", "high"] as const;
export type Energy = (typeof ENERGIES)[number];
export const DIRECTION_NOTES_MAX = 280;

export const creativeDirectionSchema = z.strictObject({
  look: z.enum(LOOKS).default("auto"),
  cast: z.enum(CASTS).default("auto"),
  energy: z.enum(ENERGIES).default("auto"),
  /** Free text. Checked by the guardrails before use and passed to Claude as quoted data, never as instructions. */
  notes: z
    .string()
    .trim()
    .max(DIRECTION_NOTES_MAX, { error: `notes must be ${DIRECTION_NOTES_MAX} characters or fewer` })
    .optional(),
});
export type CreativeDirection = z.infer<typeof creativeDirectionSchema>;
export type CreativeDirectionInput = z.input<typeof creativeDirectionSchema>;

export const DEFAULT_DIRECTION: CreativeDirection = { look: "auto", cast: "auto", energy: "auto" };
