// The founder's approval of an example store's poster background, and the art it approves. Demo media
// shows only once the founder approves it: scripts/approve-poster.ts records the approval in
// data/plans/<slug>/marketing/approved.json (the draft file, its sha256 and its prompt hash, when and by
// whom) and appends the approved poster and posts to the example's events as after-run events. The
// poster route reads the approved art from that folder, which next.config traces into the API
// functions (public/ is not in the function bundle), and draws only a file whose sha256 still matches.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { sniffImage } from "./poster-sniff";
import { posterSchema, postsSchema } from "./schema";
import type { PosterArt } from "./poster-image";

if (typeof window !== "undefined") {
  throw new Error("lib/plan/poster-approval runs on the server only.");
}

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const approvalSchema = z.strictObject({
  /** The approved draft, a file in the same folder. */
  file: z.string().regex(/^poster-bg-[0-9a-f]{12}\.(?:png|jpg|webp)$/),
  sha256: hex64,
  /** The frozen art prompt the draft was rendered from. */
  promptHash: hex64,
  approvedAt: z.iso.date(),
  by: z.string().min(1).max(40),
  /** An A/B test's variant B, approved with it: its posts, and its poster on the plain background. */
  variantB: z.strictObject({ conceptId: z.string().min(1), poster: posterSchema, posts: postsSchema }).optional(),
});
export type PosterApproval = z.infer<typeof approvalSchema>;

export const APPROVAL_FILE = "approved.json";
export const ART_MAX_BYTES = 12 * 1024 * 1024;

export const marketingDir = (slug: string, root: string = process.cwd()) => path.join(root, "data", "plans", slug, "marketing");

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** An example's approval, or null when there is none (or it does not parse). */
export function readApproval(slug: string, root?: string): PosterApproval | null {
  try {
    return approvalSchema.parse(JSON.parse(readFileSync(path.join(marketingDir(slug, root), APPROVAL_FILE), "utf8")));
  } catch {
    return null;
  }
}

const cache = new Map<string, PosterArt | null>();

/**
 * The approved background for an example, as a data URI, or null: no approval, a missing file, a file
 * whose sha256 no longer matches the approval, or bytes that are not an image. Read once per process.
 */
export function loadApprovedArt(slug: string, root?: string): PosterArt | null {
  const key = `${root ?? ""}:${slug}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let art: PosterArt | null = null;
  const approval = readApproval(slug, root);
  if (approval) {
    try {
      const bytes = readFileSync(path.join(marketingDir(slug, root), approval.file));
      const type = bytes.byteLength <= ART_MAX_BYTES && sha256Of(bytes) === approval.sha256 ? sniffImage(bytes) : null;
      art = type ? { dataUri: `data:${type};base64,${bytes.toString("base64")}` } : null;
    } catch {
      art = null;
    }
  }
  cache.set(key, art);
  return art;
}

/** Tests only: forget what was read. */
export function clearApprovedArtCache(): void {
  cache.clear();
}
