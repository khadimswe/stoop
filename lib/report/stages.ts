// Pipeline stages and their stats, shared by the Report (lib/report/schema.ts) and its concept worlds
// (lib/report/world.ts). Run-scoped stages (prove, gap, segments) report on the run; world-scoped
// ones (culture, score, concepts, prompts) report on each world, so worlds running side by side never
// overwrite each other's timings.
import { z } from "zod";

/** Pipeline stages, in progress-rail order. */
export const STAGES = ["prove", "gap", "segments", "culture", "concepts", "prompts", "score"] as const;
export type Stage = (typeof STAGES)[number];
export const stageSchema = z.enum(STAGES);

/** Work that happens after the run, each its own invocation: storyboard frames with their critique, and revisions. Trace steps only. */
export const AFTER_RUN_STAGES = ["frames", "revise"] as const;
export const traceStageSchema = z.enum([...STAGES, ...AFTER_RUN_STAGES]);
export type TraceStage = z.infer<typeof traceStageSchema>;

export const stageStatsSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  liveCalls: z.number().int().nonnegative(),
  cachedCalls: z.number().int().nonnegative(),
});
export type StageStats = z.infer<typeof stageStatsSchema>;

/**
 * What a run cost: the trace footer ("completed in 48 s · 31 Qloo calls · $0.38"). Live runs only;
 * examples are recorded. Frames and revisions add to it after the run, each re-sending the new totals.
 */
export const costSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  qloo: z.strictObject({ live: z.number().int().nonnegative(), cached: z.number().int().nonnegative() }),
  claude: z.strictObject({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  }),
  frames: z.number().int().nonnegative(),
  /** Rough dollars from list prices: an estimate, labeled as one. */
  estimateUsd: z.number().nonnegative(),
});
export type Cost = z.infer<typeof costSchema>;

/** Where a run or one of its worlds stopped early, and why. The report still shows what arrived. */
export const partialSchema = z.strictObject({ stage: stageSchema, reason: z.string().min(1) });
