// Decides what the landing hero shows. The blind test needs real, founder-approved clips; until both
// hook clips for the lead example are rendered from approved prompts and the founder has approved
// those exact files for the hero, the hero falls back to the lead example's Reality Check card and
// Screening Room.
import { LEAD_EXAMPLE as LEAD } from "./examples";
import type { DemoApprovals, DemoClip, DemoManifest } from "./manifest";

export { approvalsSchema, manifestSchema, type DemoApprovals, type DemoClip, type DemoManifest } from "./manifest";

/** The lead example's slug (lib/demo/examples.ts). The blind test still waits for its approved hook clips. */
export const LEAD_EXAMPLE: string | null = LEAD.slug;

export type HeroMode =
  | { kind: "blind-test"; example: string; control: DemoClip; culture: DemoClip }
  | { kind: "reality-check" };

/** The blind test runs only on the lead example's two hook clips, each approved as that exact file. */
export function heroMode(manifest: DemoManifest, approvals: DemoApprovals, lead: string | null): HeroMode {
  if (!lead) return { kind: "reality-check" };
  const approved = (c: DemoClip) =>
    approvals.prompts.includes(c.promptHash) &&
    approvals.heroClips.some((h) => h.id === c.id && h.promptHash === c.promptHash && h.sha256 === c.sha256);
  const hook = (role: DemoClip["role"]) => manifest.clips.find((c) => c.example === lead && c.role === role);
  const control = hook("hero-control");
  const culture = hook("hero-culture");
  if (control && culture && approved(control) && approved(culture)) {
    return { kind: "blind-test", example: lead, control, culture };
  }
  return { kind: "reality-check" };
}
