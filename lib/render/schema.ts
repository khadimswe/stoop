// Draft video renders: the plan a render starts from, the job that tracks a server-paid one, and what a
// page may see. Render jobs live in the store (keys.render), outside the Report and its reducer, so the
// recorded examples never change when a judge renders a draft. Client-safe: no secrets, no node APIs.
//
// Two payers, one plan:
//   - BYOK: the /byok page fetches the plan and calls fal from the browser with the visitor's own key,
//     which never reaches Stoop. Nothing about that render is stored server-side.
//   - Judge: POST /api/render with a judge pass; the server builds the same plan and pays with Stoop's key.
// The client never sends a prompt: plans are built on the server from the report's pack, so a render
// can only ever be one of Stoop's own guardrailed prompts.
import { z } from "zod";
import { renderTargetSchema } from "../api/requests";
import { VIDEO_MODELS } from "../prompts/models.config";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const httpsUrl = z.url({ protocol: /^https$/ });

/** The only fal endpoints a render may call, from the server or from the BYOK page. */
export const RENDER_ENDPOINTS = [VIDEO_MODELS.reference.endpoint, VIDEO_MODELS.image.endpoint] as [string, ...string[]];
export const renderEndpointSchema = z.enum(RENDER_ENDPOINTS);

export { CONTROL_SEGMENT, renderTargetSchema, type RenderTarget } from "../api/requests";

export const renderJobIdSchema = z.string().regex(/^rj_[0-9a-f]{24}$/);

/**
 * Everything fal needs for one draft, built on the server from the world's pack and storyboard.
 * reference-to-video takes 1 to 30 references (@Image1..N); image-to-video takes a start frame and an
 * optional end frame, and follows the start frame's shape, so the plan builder passes a 9:16 frame there.
 */
export const renderPlanSchema = z
  .strictObject({
  target: renderTargetSchema,
  endpoint: renderEndpointSchema,
  /** The scene prompt, with references named @Image1..N in imageUrls order. */
  prompt: z.string().min(1).max(6_000),
  /** References fal fetches: public frame URLs, or private files presigned until expiresAt. */
  imageUrls: z.array(httpsUrl).max(VIDEO_MODELS.reference.maxRefs),
  durationSeconds: z.number().int().min(4).max(15),
  resolution: z.literal("480p"),
  /** Always a draft: the final render stays off (ENABLE_FINAL_RENDER). */
  draft: z.literal(true),
  aspectRatio: z.literal("9:16"),
  generateAudio: z.boolean(),
  /** Hash of the endpoint and inputs, with references by content hash: the render cache key. */
  inputHash: hex64,
  /** Shown before anything is submitted. */
  estimatedUsd: z.number().nonnegative(),
  /** When the presigned references stop working; the BYOK page fetches a fresh plan after that. */
  expiresAt: z.iso.datetime(),
  })
  .superRefine((plan, ctx) => {
    const max = plan.endpoint === VIDEO_MODELS.image.endpoint ? VIDEO_MODELS.image.maxRefs : VIDEO_MODELS.reference.maxRefs;
    if (plan.imageUrls.length < 1 || plan.imageUrls.length > max) {
      ctx.addIssue({ code: "custom", path: ["imageUrls"], message: `${plan.endpoint} takes 1 to ${max} images` });
    }
  });
export type RenderPlan = z.infer<typeof renderPlanSchema>;

export const RENDER_STATUSES = ["queued", "rendering", "done", "failed"] as const;

/**
 * A server-paid draft, as stored. falRequestId, passId and the visitor never leave the server.
 * Refunds: a job that fails before fal accepts it gives back every counter it reserved (the day's cap,
 * the lifetime total, the pass and the IP, recorded below); once fal has accepted a job it may have
 * billed, so nothing is given back. A cached job reserved nothing (charged false).
 */
export const renderJobSchema = z.strictObject({
  id: renderJobIdSchema,
  target: renderTargetSchema,
  endpoint: renderEndpointSchema,
  inputHash: hex64,
  passId: z.string().regex(/^[0-9a-f]{24}$/),
  /** The IP visitor id and UTC day the job was counted against, so a refund finds the same counters. */
  visitor: z.string().regex(/^v_[0-9a-f]{24}$/),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationSeconds: z.number().int().min(4).max(15),
  /** False for a cached result: nothing was reserved or billed. */
  charged: z.boolean(),
  falRequestId: z.string().min(1).max(200).nullable(),
  status: z.enum(RENDER_STATUSES),
  /** The draft, stored on Stoop's public storage once fal finishes (never a fal URL, which expires). */
  videoUrl: httpsUrl.nullable(),
  reason: z.string().min(1).max(300).nullable(),
  /** True when an earlier render of the exact same inputs was reused, at no cost. */
  cached: z.boolean(),
  usd: z.number().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;

/** What a page sees of a job. */
export const renderStatusSchema = renderJobSchema.pick({ id: true, target: true, status: true, videoUrl: true, reason: true, cached: true });
export type RenderStatus = z.infer<typeof renderStatusSchema>;

export const toRenderStatus = ({ id, target, status, videoUrl, reason, cached }: RenderJob): RenderStatus => ({ id, target, status, videoUrl, reason, cached });

/**
 * Which video line the report's Output section shows for this visitor:
 *   judge: "Render draft video" (Stoop pays, judge pass present, budget left)
 *   byok: "Render with your fal key"
 *   budget-used: "Render budget used. Here's the storyboard and the example clip."
 *   off: no live video at all (the storyboard and any example clip still show)
 */
export const VIDEO_ACCESS = ["judge", "byok", "budget-used", "off"] as const;
export type VideoAccess = (typeof VIDEO_ACCESS)[number];
