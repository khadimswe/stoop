// Pipeline stages and their stats, shared by the Report (lib/report/schema.ts) and its concept worlds
// (lib/report/world.ts). Run-scoped stages (prove, gap, segments) report on the run; world-scoped
// ones (culture, score, concepts, prompts) report on each world, so worlds running side by side never
// overwrite each other's timings.
import { z } from "zod";

/** Pipeline stages, in progress-rail order. */
export const STAGES = ["prove", "gap", "segments", "culture", "concepts", "prompts", "score"] as const;
export type Stage = (typeof STAGES)[number];
export const stageSchema = z.enum(STAGES);

export const stageStatsSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  liveCalls: z.number().int().nonnegative(),
  cachedCalls: z.number().int().nonnegative(),
});
export type StageStats = z.infer<typeof stageStatsSchema>;

/** Where a run or one of its worlds stopped early, and why. The report still shows what arrived. */
export const partialSchema = z.strictObject({ stage: stageSchema, reason: z.string().min(1) });
