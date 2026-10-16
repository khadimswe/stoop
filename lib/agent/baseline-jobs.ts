// Which baseline runs a script invocation should generate. Pure, so the skip rules are tested:
// existing runs are skipped unless --force, and run 1 (the Control, fixed in advance) is never
// replaced by --force alone: it needs --reroll-control, and never once its pack is frozen.
import path from "node:path";
import { CONTROL_RUN } from "./baseline-brief";

export interface RunJob {
  slug: string;
  run: number;
  file: string;
}

export interface PlanInput {
  slugs: readonly string[];
  runs: number;
  force: boolean;
  rerollControl: boolean;
  exists: (file: string) => boolean;
}

export interface RunPlan {
  pending: RunJob[];
  /** Existing runs left alone because --force was not given. */
  skipped: number;
  /** Existing Control runs kept because --reroll-control was not given or the pack is frozen. */
  kept: { slug: string; reason: "control" | "frozen" }[];
}

export const runFile = (slug: string, run: number) => path.join("data", "baselines", slug, `run-${run}.json`);
export const conceptsFile = (slug: string) => path.join("data", "baselines", slug, "concepts.json");
export const frozenPackFile = (slug: string) => path.join("data", "packs", slug, "control.json");

export function planRuns({ slugs, runs, force, rerollControl, exists }: PlanInput): RunPlan {
  const plan: RunPlan = { pending: [], skipped: 0, kept: [] };
  for (const slug of slugs) {
    for (let run = 1; run <= runs; run++) {
      const file = runFile(slug, run);
      if (!exists(file)) {
        plan.pending.push({ slug, run, file });
        continue;
      }
      if (!force) {
        plan.skipped++;
        continue;
      }
      if (run === CONTROL_RUN) {
        if (exists(frozenPackFile(slug))) {
          plan.kept.push({ slug, reason: "frozen" });
          continue;
        }
        if (!rerollControl) {
          plan.kept.push({ slug, reason: "control" });
          continue;
        }
      }
      plan.pending.push({ slug, run, file });
    }
  }
  return plan;
}

/** True when one more step (a call plus a possible repair) still fits under the cap. */
export function fitsCap(callsSoFar: number, maxAttempts: number, cap: number): boolean {
  return callsSoFar + maxAttempts <= cap;
}
