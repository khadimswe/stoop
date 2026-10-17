// The examples' demo media, each tied to the frozen prompt it came from and to the exact file, so a
// re-render never inherits an earlier approval:
//   - clips: pre-rendered by the founder in Higgsfield, from approved Production Pack prompts
//   - packshots: one product image per example, rendered offline on fal, the reference for its frames
//   - storyboards: up to 4 frames per world (or the Control), rendered offline on fal and critiqued
// public/demo/manifest.json lists what exists (written by scripts/render-demo.ts); public/demo/approvals.json
// lists what the founder approved, by hand. Pages show only approved media. Files are served from our own
// origin under /demo, never from a storage vendor.
import { z } from "zod";
import { CONTROL_SEGMENT, segmentIdSchema } from "../api/requests";
import { frameCritiqueSchema } from "../report/world";
import { EXAMPLES, type ExampleSlug } from "./examples";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, { error: "must be a lowercase hex sha256" });
const exampleSlug = z.enum(EXAMPLES.map((e) => e.slug) as [ExampleSlug, ...ExampleSlug[]]);

/** A path served from public/, e.g. /demo/food-hot-sauce/frames/w1-0.webp. */
function servedPath(extensions: readonly string[]) {
  const pattern = new RegExp(`^/demo/[a-z0-9/_.-]+\\.(${extensions.join("|")})$`, "i");
  return z
    .string()
    .regex(pattern, { error: `must be a /demo/... path ending in ${extensions.join(", ")}` })
    .refine((path) => !path.split("/").includes(".."), { error: "must not contain .." });
}
const IMAGE = ["webp", "png", "jpg", "jpeg"] as const;

/** A world's segment id, or null for the Control. */
const segmentId = segmentIdSchema.nullable();
/** Frames per storyboard: lib/prompts/frames.ts FRAMES_PER_WORLD (a test keeps the two equal; that module is not client-light). */
export const MAX_DEMO_FRAMES = 4;

const clipSchema = z
  .strictObject({
    id: z.string().min(1),
    example: exampleSlug,
    role: z.enum(["hero-control", "hero-culture", "control", "culture"]),
    segmentId,
    file: servedPath(["mp4", "webm"]),
    poster: servedPath(IMAGE).nullable(),
    /** WebVTT captions for a voiced clip. */
    captions: servedPath(["vtt"]).nullable(),
    /** Hash of the frozen Production Pack prompt the clip was rendered from. */
    promptHash: sha256,
    /** Hash of the rendered file itself. */
    sha256,
  })
  .refine((clip) => (clip.role === "control" || clip.role === "hero-control") === (clip.segmentId === null), {
    error: "a Control clip has no segment; a culture clip names its world's segment",
  });
export type DemoClip = z.infer<typeof clipSchema>;

const demoFrameSchema = z.strictObject({
  /** Index into the kept concept's scenes, as in the report's frames. */
  scene: z.number().int().min(0),
  file: servedPath(IMAGE),
  promptHash: sha256,
  sha256,
  modelId: z.string().regex(/^[a-z0-9][a-z0-9./-]{0,99}$/),
  /** 1: the first render; 2: the re-render after the critique. */
  attempt: z.union([z.literal(1), z.literal(2)]),
});
export type DemoFrame = z.infer<typeof demoFrameSchema>;

const storyboardSchema = z
  .strictObject({
    example: exampleSlug,
    segmentId,
    frames: z.array(demoFrameSchema).min(1).max(MAX_DEMO_FRAMES),
    critiques: z.array(frameCritiqueSchema),
  })
  .refine((board) => new Set(board.frames.map((f) => f.scene)).size === board.frames.length, { error: "each scene has one frame" });
export type DemoStoryboard = z.infer<typeof storyboardSchema>;

const packshotSchema = z.strictObject({
  example: exampleSlug,
  file: servedPath(IMAGE),
  promptHash: sha256,
  sha256,
  modelId: z.string().regex(/^[a-z0-9][a-z0-9./-]{0,99}$/),
});
export type DemoPackshot = z.infer<typeof packshotSchema>;

function noDuplicates<T>(items: readonly T[], keyOf: (item: T) => string, path: string, ctx: z.RefinementCtx, what: string) {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const key = keyOf(item);
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [path, index], message: `duplicate ${what} "${key}"` });
    seen.add(key);
  }
}

/** public/demo/manifest.json */
export const manifestSchema = z
  .strictObject({
    version: z.literal(2),
    clips: z.array(clipSchema),
    storyboards: z.array(storyboardSchema),
    packshots: z.array(packshotSchema),
  })
  .superRefine((manifest, ctx) => {
    noDuplicates(manifest.clips, (c) => c.id, "clips", ctx, "clip id");
    noDuplicates(manifest.storyboards, (s) => `${s.example}/${s.segmentId ?? "control"}`, "storyboards", ctx, "storyboard");
    noDuplicates(manifest.packshots, (p) => p.example, "packshots", ctx, "packshot for");
  });
export type DemoManifest = z.infer<typeof manifestSchema>;

/** public/demo/approvals.json: what the founder approved, by hand. Nothing here is ever seeded. */
export const approvalsSchema = z.strictObject({
  version: z.literal(2),
  /** Prompt hashes approved for rendering (scripts/render-demo.ts refuses anything else). */
  prompts: z.array(sha256),
  /** Rendered files (clips, packshots and storyboard frames) approved after watching or looking at them, by file hash. */
  files: z.array(sha256),
  /** Exact clips approved for the landing blind test, after watching them. */
  heroClips: z.array(z.strictObject({ id: z.string().min(1), promptHash: sha256, sha256 })),
});
export type DemoApprovals = z.infer<typeof approvalsSchema>;

/** Approved media for one example: what a page may show. A render whose prompt or file is unapproved is left out. */
export interface DemoMedia {
  packshot: DemoPackshot | null;
  /** Keyed by segment id, "control" for the Control. Only storyboards whose every frame is approved. */
  storyboards: Record<string, DemoStoryboard>;
  /** Clips whose prompt and file are both approved (the blind test also needs heroClips: lib/demo/hero.ts). */
  clips: DemoClip[];
}

export const CONTROL_KEY = CONTROL_SEGMENT;

export function demoMediaFor(manifest: DemoManifest, approvals: DemoApprovals, example: ExampleSlug): DemoMedia {
  const prompt = new Set(approvals.prompts);
  const file = new Set(approvals.files);
  const packshot = manifest.packshots.find((p) => p.example === example && prompt.has(p.promptHash) && file.has(p.sha256)) ?? null;
  const storyboards: Record<string, DemoStoryboard> = {};
  for (const board of manifest.storyboards) {
    if (board.example !== example) continue;
    if (!board.frames.every((f) => prompt.has(f.promptHash) && file.has(f.sha256))) continue;
    storyboards[board.segmentId ?? CONTROL_KEY] = board;
  }
  const clips = manifest.clips.filter((c) => c.example === example && prompt.has(c.promptHash) && file.has(c.sha256));
  return { packshot, storyboards, clips };
}
