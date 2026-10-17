// What each API route answers. Routes parse their answers with these; the browser imports them as
// types only (they pull in the Report schema).
import { z } from "zod";
import { evidenceSchema } from "../evidence";
import { productSpecSchema } from "../prompts/brief";
import { costSchema, reportSchema, seedSchema } from "../report/schema";
import { ageBandLabel, ageBucketSchema } from "../types";
import { TOKEN_PATTERN } from "../mcp/token";
import { renderPlanSchema, renderStatusSchema, VIDEO_ACCESS } from "../render/schema";
import { exampleSlugSchema, runIdSchema, intakeIdSchema, VOTE_CHOICES } from "./requests";

const evidenceIdSchema = z.string().regex(/^ev_[0-9a-f]{12}$/);
const eventsUrl = z.string().regex(/^\/api\/run\/[a-z0-9_-]+\/events$/);
/** Blind-test results stay "early results" until this many votes. */
export const EARLY_VOTES = 30;

// --- Errors --------------------------------------------------------------------------------------

export const API_ERROR_CODES = ["invalid", "not_found", "rate_limited", "daily_cap", "busy", "off", "bot", "failed"] as const;
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(API_ERROR_CODES), message: z.string().min(1).max(300) }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- POST /api/intake ----------------------------------------------------------------------------

/** "Your site speaks to X": Claude's reading of the page, in Qloo's dimensions. Never Qloo origin. */
export const siteReadingSchema = z.strictObject({
  label: z.literal("Read from your site"),
  ageBands: z
    .array(
      z
        .strictObject({ bucket: ageBucketSchema, label: z.string() })
        // 24_and_younger always reads "18 to 24": the label comes from the bucket, never from the page.
        .refine((band) => band.label === ageBandLabel(band.bucket), { error: "an age band's label must match its bucket" }),
    )
    .max(3),
  genderSkew: z.enum(["female", "male", "balanced"]).nullable(),
  place: z.string().nullable(),
  tags: z.array(z.strictObject({ id: z.string().min(1), name: z.string().min(1), evidenceIds: z.array(evidenceIdSchema).min(1) })),
});

export const intakeResponseSchema = z.strictObject({
  intakeId: intakeIdSchema,
  /** The product as the run will use it, with the seller's own words as `sellerFacts`. */
  product: productSpecSchema,
  /** Null when the page could not be read (or no link was given). */
  site: siteReadingSchema.nullable(),
  /** Why the link could not be read; the run falls back to the description. */
  blocked: z.strictObject({ reason: z.string().min(1) }).nullable(),
  /** Proposed seeds with their origin, shown before a run. */
  seeds: z.array(seedSchema),
  /** Receipts for the seeds and the reading's tags. */
  evidence: z.array(evidenceSchema),
  /** Agent decisions for the /start screen ("Dropped 2 suggestions Qloo could not match"). */
  notes: z.array(z.string()),
});
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;

// --- GET /api/search ------------------------------------------------------------------------------

export const searchResponseSchema = z.strictObject({
  /** Each result is a seed with origin `you`, ready to add, with its receipt. */
  results: z.array(seedSchema).max(8),
  evidence: z.array(evidenceSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// --- POST /api/run --------------------------------------------------------------------------------

/** Why a start became an example replay instead of a live run. */
export const REPLAY_REASONS = ["replay", "busy", "daily-cap", "rate-limited"] as const;

export const runStartResponseSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("live"),
    runId: runIdSchema,
    eventsUrl,
    reportUrl: z.string().regex(/^\/report\/[a-z0-9_-]+$/),
    /** True when the same brief was already running, so this start joined it. */
    joined: z.boolean(),
  }),
  z.strictObject({
    mode: z.literal("example"),
    slug: exampleSlugSchema,
    reason: z.enum(REPLAY_REASONS),
    /** One line for the banner ("Live runs are busy right now. Here's an example while you wait."). */
    message: z.string().min(1).max(200),
  }),
]);
export type RunStartResponse = z.infer<typeof runStartResponseSchema>;

// --- GET /api/run/[id]/events (SSE) ---------------------------------------------------------------

/** A stored run's status: running; stopped (hit the deadline or crashed, resumable); done and failed (ended). */
export const RUN_META_STATUSES = ["running", "stopped", "done", "failed"] as const;
export type RunMetaStatus = (typeof RUN_META_STATUSES)[number];

/**
 * The stream's own status message (SSE `event: status`), next to the run events: tells the viewer
 * which attempt is streaming, and when a run stopped and can be resumed (the Resume button).
 */
export const streamStatusSchema = z.strictObject({
  status: z.enum(RUN_META_STATUSES),
  attempt: z.number().int().min(1),
  resumable: z.boolean(),
});
export type StreamStatus = z.infer<typeof streamStatusSchema>;

// --- GET /api/report/[id] -------------------------------------------------------------------------

export const reportResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("done"),
    report: reportSchema,
    /** Where frames and revisions still arrive (reduce the stream from the start); null for examples and expired runs. */
    eventsUrl: eventsUrl.nullable(),
  }),
  /** Still running, or stopped and resumable: follow the events. */
  z.strictObject({ status: z.literal("running"), runId: runIdSchema, eventsUrl, resumable: z.boolean() }),
]);
export type ReportResponse = z.infer<typeof reportResponseSchema>;

// --- POST /api/frames/[id] ------------------------------------------------------------------------

export const framesResponseSchema = z.strictObject({
  status: z.enum(["rendering", "done", "paused"]),
  /** "Storyboards paused today" when the daily frame cap is spent. */
  message: z.string().max(200).nullable(),
});
export type FramesResponse = z.infer<typeof framesResponseSchema>;

// --- POST /api/revise -----------------------------------------------------------------------------

export const reviseResponseSchema = z.strictObject({
  status: z.enum(["revising", "capped"]),
  revisionId: z.string().regex(/^rev-[0-9a-f]{12}$/).nullable(),
  eventsUrl: eventsUrl.nullable(),
  message: z.string().max(200).nullable(),
});
export type ReviseResponse = z.infer<typeof reviseResponseSchema>;

// --- POST /api/waitlist ---------------------------------------------------------------------------

export const waitlistResponseSchema = z.strictObject({ position: z.number().int().positive() });
export type WaitlistResponse = z.infer<typeof waitlistResponseSchema>;

// --- POST and GET /api/vote -----------------------------------------------------------------------

/** Real votes, never seeded: always with n, and "early results" under EARLY_VOTES. */
export const voteResponseSchema = z
  .strictObject({
    example: exampleSlugSchema,
    culture: z.number().int().nonnegative(),
    control: z.number().int().nonnegative(),
    n: z.number().int().nonnegative(),
    early: z.boolean(),
    /** This visitor's vote, if they voted. */
    yours: z.enum(VOTE_CHOICES).nullable(),
  })
  .refine((v) => v.n === v.culture + v.control && v.early === v.n < EARLY_VOTES, { error: "n and early must match the counts" });
export type VoteResponse = z.infer<typeof voteResponseSchema>;

// --- GET /api/health ------------------------------------------------------------------------------

const capSchema = z.strictObject({ used: z.number().int().nonnegative(), cap: z.number().int().nonnegative() });
export const healthResponseSchema = z.strictObject({
  ok: z.boolean(),
  /** STOOP_LIVE: off means every start replays an example. */
  live: z.boolean(),
  store: z.enum(["memory", "upstash", "unreachable"]),
  caps: z.strictObject({ liveRuns: capSchema, frames: capSchema, qloo: capSchema, renders: capSchema }),
  /** The last x-month-ratelimit-remaining Qloo sent, if any call has been made. */
  qlooMonthRemaining: z.number().int().nullable(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** The trace footer: "completed in 48 s · 31 Qloo calls · $0.38". */
// --- Draft video: GET /api/render/access, POST /api/render/plan, POST /api/render, GET /api/render/[job]

/** Which video line the Output section shows this visitor, and how many server-paid drafts their pass has left. */
export const renderAccessResponseSchema = z.strictObject({
  video: z.enum(VIDEO_ACCESS),
  rendersLeft: z.number().int().nonnegative().nullable(),
  byok: z.boolean(),
});
export type RenderAccessResponse = z.infer<typeof renderAccessResponseSchema>;

export const renderPlanResponseSchema = z.strictObject({ plan: renderPlanSchema });
export type RenderPlanResponse = z.infer<typeof renderPlanResponseSchema>;

export const renderStatusResponseSchema = z.strictObject({ job: renderStatusSchema });
export type RenderStatusResponse = z.infer<typeof renderStatusResponseSchema>;

// --- POST /api/mcp/token ------------------------------------------------------------------------

/** The token, shown once. */
export const mcpTokenResponseSchema = z.strictObject({
  token: z.string().regex(TOKEN_PATTERN),
  expiresAt: z.iso.datetime(),
  /** Whether the copy by email went out (no email without Resend keys). */
  emailed: z.boolean(),
});
export type McpTokenResponse = z.infer<typeof mcpTokenResponseSchema>;

export { costSchema };
