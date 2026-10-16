// Decides what the landing hero shows. The blind test needs real, founder-approved clips; until both
// hook clips for the lead example are rendered from approved prompts and the founder has approved
// those exact files for the hero, the hero falls back to the lead example's Reality Check card and
// Screening Room.
import { z } from "zod";

/** Set in Gate 2, when the data picks the lead example. Null keeps the fallback hero. */
export const LEAD_EXAMPLE: string | null = null;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, { error: "must be a lowercase hex sha256" });

const clip = z.strictObject({
  id: z.string().min(1),
  example: z.string().min(1),
  role: z.enum(["hero-control", "hero-culture", "control", "culture"]),
  /** Served path under public/, e.g. /demo/hot-sauce/hero-culture.mp4 */
  file: z
    .string()
    .regex(/^\/demo\/[a-z0-9/_.-]+\.(mp4|webm)$/i, { error: "must be a /demo/... .mp4 or .webm path" })
    .refine((path) => !path.split("/").includes(".."), { error: "must not contain .." }),
  /** Hash of the frozen Production Pack prompt the clip was rendered from. */
  promptHash: z.string().min(1),
  /** Hash of the rendered file itself, so a re-render never inherits an earlier approval. */
  sha256,
});
export type DemoClip = z.infer<typeof clip>;

/** public/demo/manifest.json: one entry per pre-rendered clip, written by scripts/render-demo.ts. */
export const manifestSchema = z
  .strictObject({
    version: z.literal(1),
    clips: z.array(clip),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const [index, { id }] of manifest.clips.entries()) {
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["clips", index, "id"], message: `duplicate clip id "${id}"` });
      seen.add(id);
    }
  });
export type DemoManifest = z.infer<typeof manifestSchema>;

/** public/demo/approvals.json: what the founder approved, by hand. */
export const approvalsSchema = z.strictObject({
  version: z.literal(1),
  /** Prompt hashes approved for rendering (scripts/render-demo.ts refuses anything else). */
  prompts: z.array(z.string().min(1)),
  /** Exact rendered files approved for the landing blind test, after watching them. */
  heroClips: z.array(z.strictObject({ id: z.string().min(1), promptHash: z.string().min(1), sha256 })),
});
export type DemoApprovals = z.infer<typeof approvalsSchema>;

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
