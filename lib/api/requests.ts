// What the browser sends to each API route, checked with the same schemas on both sides. Kept light
// (zod and small constants only) so /start and the forms can import them without the Report schema;
// responses live in ./responses and are imported by the browser as types only. Free text (the stated
// customer, notes, a revise reason) is capped here and is quoted data, never instructions: it still
// passes the guardrails on the server.
import { z } from "zod";
import { EXAMPLES } from "../demo/examples";
import { MAX_URL_LENGTH } from "../intake/address";
import { SELLS_ON } from "../sells-on";
import { CULTURE_FIELDS, creativeDirectionSchema, DEFAULT_DIRECTION } from "../types";

/** Live run ids ("run_" plus 24 hex) and example run ids ("example-<slug>"). */
export const runIdSchema = z.string().regex(/^(?:run_[0-9a-f]{24}|example-[a-z0-9]+(?:-[a-z0-9]+)*)$/);
/** A live run: frames and revisions work only on runs kept in the store, never on the static examples. */
export const liveRunIdSchema = z.string().regex(/^run_[0-9a-f]{24}$/);
/** "in_" plus 24 hex: an intake waiting for /start's confirmation. */
export const intakeIdSchema = z.string().regex(/^in_[0-9a-f]{24}$/);
export const segmentIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
const exampleSlugs = EXAMPLES.map((e) => e.slug) as [(typeof EXAMPLES)[number]["slug"], ...(typeof EXAMPLES)[number]["slug"][]];
/** Only the shipped examples: anything else would let a caller create store keys at will. */
export const exampleSlugSchema = z.enum(exampleSlugs);

export const STATED_CUSTOMER_MAX = 280;
export const REASON_MAX = 280;
export const DESCRIPTION_MAX = 2_000;
/** How many seeds a run takes (the /start step shows 3 to 5; Prove needs at least 2 that resolve). */
export const RUN_SEEDS = { min: 2, max: 8 } as const;
/** What a "you" seed can be: the types Qloo's autocomplete resolves and Prove reads as signal. */
export const SEARCH_TYPES = ["brand", "artist", "movie", "tv_show", "podcast", "book", "videogame"] as const;

const webUrl = z.url({ protocol: /^https?$/, error: "must be an http(s) link" }).max(MAX_URL_LENGTH);
const statedCustomer = z.string().trim().max(STATED_CUSTOMER_MAX);
const region = z.string().trim().min(2).max(80);

// --- POST /api/intake ----------------------------------------------------------------------------

/** "What are you selling?": a store or product link first, a description as the fallback. */
export const intakeRequestSchema = z
  .strictObject({
    url: webUrl.optional(),
    description: z.string().trim().min(20).max(DESCRIPTION_MAX).optional(),
    brandName: z.string().trim().min(1).max(100).optional(),
    statedCustomer: statedCustomer.optional(),
    region: region.default("United States"),
  })
  .refine((input) => input.url || input.description, { error: "give a product link or a description" });
export type IntakeRequest = z.input<typeof intakeRequestSchema>;

// --- GET /api/search ------------------------------------------------------------------------------

/** Qloo autocomplete for a "you" seed, tied to an intake so a run only accepts what Qloo resolved. */
export const searchRequestSchema = z.strictObject({
  intakeId: intakeIdSchema,
  q: z.string().trim().min(2).max(80),
  type: z.enum(SEARCH_TYPES),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// --- POST /api/run --------------------------------------------------------------------------------

/** The confirmed inputs from /start. Seeds are named by id: only seeds this intake proposed or searched count. */
export const runStartRequestSchema = z.strictObject({
  intakeId: intakeIdSchema,
  seedIds: z
    .array(z.string().min(1).max(128))
    .min(RUN_SEEDS.min)
    .max(RUN_SEEDS.max)
    .refine((ids) => new Set(ids).size === ids.length, { error: "seeds must be different" }),
  statedCustomer: statedCustomer.nullable(),
  region,
  direction: creativeDirectionSchema.default(DEFAULT_DIRECTION),
});
export type RunStartRequest = z.input<typeof runStartRequestSchema>;

// --- GET /api/run/[id]/events (SSE) ---------------------------------------------------------------

/** `Last-Event-ID` is "<attempt>:<seq>", so a resumed run (a higher attempt) starts over at seq 0. */
export const lastEventIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,2}:\d{1,6}$/)
  .transform((value) => {
    const [attempt, seq] = value.split(":").map(Number);
    return { attempt, seq };
  });
export const eventId = (attempt: number, seq: number) => `${attempt}:${seq}`;

// --- POST /api/frames/[id] ------------------------------------------------------------------------

export const framesRequestSchema = z.strictObject({ segmentId: segmentIdSchema });
export type FramesRequest = z.infer<typeof framesRequestSchema>;

// --- POST /api/revise -----------------------------------------------------------------------------

/** "Not this vibe" on one cue, or on the whole world. */
export const reviseRequestSchema = z.strictObject({
  runId: liveRunIdSchema,
  segmentId: segmentIdSchema,
  field: z.enum([...CULTURE_FIELDS, "world"]),
  /** Qloo entity or tag ids to leave out of the new pick; the server keeps only ids from this world's sources. */
  exclude: z.array(z.string().min(1).max(128)).max(12).default([]),
  reason: z.string().trim().max(REASON_MAX).default(""),
});
export type ReviseRequest = z.input<typeof reviseRequestSchema>;

// --- POST /api/waitlist ---------------------------------------------------------------------------

export const PLANS = ["free", "campaign", "founder", "studio"] as const;
const sellsOnValues = SELLS_ON.map((option) => option.value) as [(typeof SELLS_ON)[number]["value"], ...(typeof SELLS_ON)[number]["value"][]];

export const waitlistRequestSchema = z.strictObject({
  email: z.email().max(254),
  sellsOn: z.enum(sellsOnValues).nullable(),
  /** Consent to product emails beyond the confirmation. */
  consent: z.boolean(),
  /** Set when "Reserve" was pressed on a pricing card. */
  plan: z.enum(PLANS).optional(),
  /** Where the signup came from: an example slug, a run id or a page name. Never free text (it lands in the CSV export). */
  sourceReport: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).optional(),
  /** The success screen's product link, the free-brief request. */
  productLink: webUrl.optional(),
  /** Honeypot: humans never see or fill it. A filled one is accepted and dropped. */
  company: z.string().max(200).optional(),
});
export type WaitlistRequest = z.infer<typeof waitlistRequestSchema>;

// --- POST /api/vote -------------------------------------------------------------------------------

export const VOTE_CHOICES = ["culture", "control"] as const;
export const voteRequestSchema = z.strictObject({ example: exampleSlugSchema, choice: z.enum(VOTE_CHOICES) });
export type VoteRequest = z.infer<typeof voteRequestSchema>;

// --- POST /api/render/plan (BYOK) and POST /api/render (judge pass) --------------------------------

export const CONTROL_SEGMENT = "control";

/** Which world of which report: an example ("example-<slug>") or a live run, and a segment id or the Control. */
export const renderTargetSchema = z.strictObject({
  reportId: runIdSchema,
  segment: z.union([segmentIdSchema, z.literal(CONTROL_SEGMENT)]),
});
export type RenderTarget = z.infer<typeof renderTargetSchema>;

/** Only the target: the server builds the prompt from the report's own pack, never from the request. */
export const renderRequestSchema = z.strictObject({ target: renderTargetSchema });
export type RenderRequest = z.infer<typeof renderRequestSchema>;

// --- POST /api/mcp/token --------------------------------------------------------------------------

export const mcpTokenRequestSchema = z.strictObject({
  email: z.email().max(254),
  /** Consent to product emails beyond the token email itself. */
  consent: z.boolean(),
  /** Honeypot, as on the waitlist: a filled one is answered like a success and dropped. */
  company: z.string().max(200).optional(),
});
export type McpTokenRequest = z.infer<typeof mcpTokenRequestSchema>;
