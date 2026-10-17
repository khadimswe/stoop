// The Campaign Kit, grouped under each world: the kept concept's hook, what it tests, the scripts and
// the ad plan entry.
import { UGC_FORMAT_SPECS } from "../../prompts/ugc/formats";
import type { Report } from "../schema";
import type { UgcScript } from "../world";
import { currentWorld, keptConcept } from "./current";
import type { ScriptView } from "./types";

export interface KitWorldView {
  segmentId: string;
  label: string;
  /** The Creative Director's hook (origin `creative`). */
  hook: string | null;
  testHypothesis: string | null;
  scripts: ScriptView[];
  adPlan: { name: string; watch: string; note: string } | null;
}

export interface KitView {
  worlds: KitWorldView[];
}

export function scriptView({ format, platform, tool, script, cta }: UgcScript): ScriptView {
  return { format, formatLabel: UGC_FORMAT_SPECS[format].label, platform, tool, script, cta };
}

export function kitView(report: Report): KitView {
  return {
    worlds: report.worlds.map((world) => {
      const parts = currentWorld(world);
      const concept = keptConcept(parts);
      const plan = parts.kit?.adPlan ?? null;
      return {
        segmentId: world.segmentId,
        label: world.label,
        hook: concept?.hook ?? null,
        testHypothesis: concept?.testHypothesis ?? null,
        scripts: (parts.kit?.ugc ?? []).map(scriptView),
        adPlan: plan && { name: plan.name, watch: plan.watch, note: plan.note },
      };
    }),
  };
}
