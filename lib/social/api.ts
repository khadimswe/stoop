// What the social routes take and answer, in a plain module the UI can import: the post request, the
// per-channel results and the connected Pages (names and ids only: tokens never leave the server).
import { z } from "zod";
import { SOCIAL_CHANNELS } from "./trail";

export const META_ERROR_KINDS = ["auth", "permission", "rate_limited", "image", "invalid", "unavailable", "not_linked", "schedule"] as const;
export type MetaErrorKind = (typeof META_ERROR_KINDS)[number];

/** POST /api/plan/[id]/social/post */
export const socialPostRequestSchema = z.strictObject({
  pageId: z.string().regex(/^\d{1,30}$/, { error: "Pick one of your Pages." }),
  channels: z
    .array(z.enum(SOCIAL_CHANNELS))
    .min(1, { error: "Pick Facebook, Instagram or both." })
    .max(2)
    .refine((list) => new Set(list).size === list.length, { error: "Each channel once." }),
  /** "now", or the instant to schedule at (ISO with a zone): 10 minutes to 75 days ahead. */
  when: z.union([z.literal("now"), z.iso.datetime({ offset: true })]),
});
export type SocialPostRequest = z.infer<typeof socialPostRequestSchema>;

export const SOCIAL_POST_STATUSES = ["posted", "scheduled", "failed", "skipped"] as const;

export const socialPostResultSchema = z.strictObject({
  channel: z.enum(SOCIAL_CHANNELS),
  status: z.enum(SOCIAL_POST_STATUSES),
  /** "Posted to Facebook at 7:02 pm on Fri, Nov 6", or why it did not go, in plain words. */
  message: z.string().min(1).max(300),
  /** The post on Facebook or Instagram, when Meta gave one. */
  link: z.url().nullable(),
  error: z.enum(META_ERROR_KINDS).nullable(),
});
export type SocialPostResult = z.infer<typeof socialPostResultSchema>;

export const socialPostResponseSchema = z.strictObject({ results: z.array(socialPostResultSchema).min(1).max(2) });
export type SocialPostResponse = z.infer<typeof socialPostResponseSchema>;

/** GET /api/social/meta/pages */
export const socialPagesResponseSchema = z.strictObject({
  connected: z.boolean(),
  pages: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      canPost: z.boolean(),
      instagram: z.strictObject({ username: z.string().nullable() }).nullable(),
    }),
  ),
});
export type SocialPagesResponse = z.infer<typeof socialPagesResponseSchema>;

/** Where the routes live. */
export const SOCIAL_ROUTES = {
  start: (returnTo: string) => `/api/social/meta/start?return=${encodeURIComponent(returnTo)}`,
  pages: "/api/social/meta/pages",
  disconnect: "/api/social/meta/disconnect",
  post: (planId: string) => `/api/plan/${encodeURIComponent(planId)}/social/post`,
} as const;

/** The query flag the callback adds to the page it returns to. */
export const META_RETURN_PARAM = "meta";
export const META_OUTCOMES = ["connected", "denied", "expired", "failed"] as const;
export type MetaOutcome = (typeof META_OUTCOMES)[number];
