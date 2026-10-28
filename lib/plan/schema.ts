// The Event Plan: everything one store-events run produces, the shape the UI renders for live runs,
// finished runs and example replays alike. It is the contract between the pipeline lane (stages), the
// marketing lane (poster and posts) and the UI lane, so it changes only through its own small commit.
//
// What a run measures, per store: the city's taste (local artists and music styles, by city name) and
// the block (Qloo places near the store: food spots, venues, parks). Neighborhood-level taste is not
// used: on the hackathon key a map-point signal barely re-ranks results and neighborhood names resolve
// inconsistently (docs/store-events-memo.md, "What Qloo can and can't do here").
//
// Every Qloo-backed item carries evidence ids into `ledger`: no evidence, no display. Plan text refers
// to measured artists and places by id tokens ("[[id]]", lib/plan/refs.ts); names are rendered from
// `local`, never written by the model.
import { z } from "zod";
import { evidenceSchema } from "../evidence";
import { AGE_BUCKETS } from "../qloo/constants";
import { costSchema, stageStatsSchema } from "../report/stages";
import { CUE_ORIGINS } from "../types";
import { refsIn } from "./refs";

export const PLAN_VERSION = 1;

const evidenceIds = z.array(z.string().regex(/^ev_[0-9a-f]{12}$/));
const slug = z.string().regex(/^[a-z0-9-]+$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// --- Inputs ----------------------------------------------------------------------------------

/** Text only: the plan names the carrier in words and never draws its logo. */
export const CARRIERS = ["metro", "cricket", "boost", "other"] as const;
/** Where the event happens. Stores that do well go outside: a table on the sidewalk, or a booth at a fair or community event. */
export const SETTINGS = ["sidewalk_table", "in_store", "nearby_venue", "community_event"] as const;

export const storeSchema = z.strictObject({
  id: slug,
  /** The store's display name. Example stores are fictional. */
  name: z.string().min(1).max(80),
  carrier: z.enum(CARRIERS),
  address: z.string().min(1).max(200),
  /** The city name Qloo resolves (signal.location.query), e.g. "Chicago". */
  city: z.string().min(1).max(80),
  region: z.string().min(1).max(40),
  /** The store itself: places near it are searched around this point (filter.location). */
  point: z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
});
export type Store = z.infer<typeof storeSchema>;

/** A fact the manager typed ("$25 unlimited, free phone with port-in"). The plan never invents an offer. */
export const offerSchema = z.strictObject({ text: z.string().min(1).max(140) });

export const inputsSchema = z.strictObject({
  store: storeSchema,
  /** The event day, in the store's local time. */
  date: z.iso.date(),
  startTime: hhmm,
  durationMinutes: z.number().int().min(30).max(480),
  setting: z.enum(SETTINGS),
  /**
   * Where the event happens when it isn't at the store (a fair, a festival, a nearby venue). Places
   * near the event are searched around this point instead of the store's.
   */
  location: z.strictObject({ name: z.string().min(1).max(120), point: z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }) }).optional(),
  budgetUsd: z.number().int().min(0).max(5000),
  /** Up to 8 promos, enough to fill a tabletop prize wheel with the store's real deals. */
  offers: z.array(offerSchema).max(8),
  /** Adult bands only; the youngest bucket always shows as "18 to 24". */
  ageBands: z.array(z.enum(AGE_BUCKETS)).min(1).max(3),
  /** The manager's own vision (280 characters), passed to Claude as quoted data, never as instructions. */
  notes: z.string().max(280).optional(),
});
export type PlanInputs = z.infer<typeof inputsSchema>;

// --- What Qloo measured ----------------------------------------------------------------------

export const artistRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  rank: z.number().int().min(1),
  /** Qloo's own genre property for the artist, when present. */
  genres: z.array(z.string()),
  evidenceIds,
});
export type ArtistRef = z.infer<typeof artistRefSchema>;

/** A music style the city leans toward, after identity-type tags are removed. */
export const styleSchema = z.strictObject({ tagId: z.string().min(1), name: z.string().min(1), evidenceIds });
export type MusicStyle = z.infer<typeof styleSchema>;

export const cityTasteSchema = z.strictObject({
  city: z.string().min(1),
  ageBands: z.array(z.enum(AGE_BUCKETS)).min(1),
  artists: z.array(artistRefSchema),
  styles: z.array(styleSchema),
});
export type CityTaste = z.infer<typeof cityTasteSchema>;

export const PLACE_KINDS = ["food", "venue", "park", "shop", "other"] as const;

export const placeSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(PLACE_KINDS),
  /** Qloo tag names on the place, e.g. "Mexican", "Live music venue", "Lemonade". */
  tags: z.array(z.string()),
  address: z.string().nullable(),
  /** Qloo's coordinates for the place, for the block map (the store at the center, places around it). */
  point: z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable().optional(),
  distanceM: z.number().nonnegative().nullable(),
  /** Qloo's explainability for the place, shown as is. */
  why: z.string().nullable(),
  rank: z.number().int().min(1),
  affinity: z.number().nullable(),
  popularity: z.number().nullable(),
  /** A national chain: fine for gift cards and snack runs, never a co-promo partner. */
  chain: z.boolean().optional(),
  evidenceIds,
});
export type Place = z.infer<typeof placeSchema>;

export const blockSchema = z.strictObject({
  radiusM: z.number().int().positive(),
  places: z.array(placeSchema),
});
export type Block = z.infer<typeof blockSchema>;

export const localSchema = z.strictObject({
  city: cityTasteSchema.nullable(),
  block: blockSchema.nullable(),
  /** What Qloo had no signal for, said plainly ("No Qloo signal for parks near this store"). */
  gaps: z.array(z.string().min(1)),
});
export type Local = z.infer<typeof localSchema>;

// --- The plan ---------------------------------------------------------------------------------

export const ITEM_KINDS = ["theme", "music", "food", "partner", "venue", "giveaway", "activity", "setup", "signage", "timing"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * One line of a plan. Origins mean what they mean everywhere in Stoop: `qloo` (Qloo returned it),
 * `interpreted` (wording that cites Qloo items), `creative` (not from Qloo) or `yours` (the manager's
 * own choice). Qloo-backed lines need a receipt; refs are the measured artists and places the text
 * names through "[[id]]" tokens.
 */
export const planItemSchema = z
  .strictObject({
    kind: z.enum(ITEM_KINDS),
    /** Room for two or three ref tokens (about 40 characters each) plus a full sentence. */
    text: z.string().min(1).max(320),
    origin: z.enum(CUE_ORIGINS),
    refs: z.array(z.string().min(1)),
    evidenceIds,
  })
  .superRefine((item, ctx) => {
    if ((item.origin === "qloo" || item.origin === "interpreted") && item.evidenceIds.length === 0) {
      ctx.addIssue({ code: "custom", message: `a ${item.origin} item needs a Qloo receipt`, path: ["evidenceIds"] });
    }
    const named = refsIn(item.text);
    for (const id of named) if (!item.refs.includes(id)) ctx.addIssue({ code: "custom", message: `text names [[${id}]], which is not in refs`, path: ["text"] });
  });
export type PlanItem = z.infer<typeof planItemSchema>;

export const rubricScoreSchema = z.strictObject({ criterion: z.string().min(1), score: z.number().int().min(1).max(5) });

export const conceptSchema = z.strictObject({
  id: slug,
  title: z.string().min(1).max(60),
  /** Why someone walking by stops, in one line. */
  hook: z.string().min(1).max(140),
  items: z.array(planItemSchema).min(1),
  scores: z.array(rubricScoreSchema),
  total: z.number(),
  kept: z.boolean(),
  /** Why it was not kept, for the collapsed alternatives. */
  note: z.string().optional(),
});
export type Concept = z.infer<typeof conceptSchema>;

export const runOfShowStepSchema = z.strictObject({ time: hhmm, step: z.string().min(1).max(220) });

export const shoppingItemSchema = z.strictObject({
  item: z.string().min(1).max(120),
  qty: z.string().max(40).optional(),
  estUsd: z.number().nonnegative().optional(),
  /** A block partner to buy it from (a place id in `local.block`), when there is one. */
  from: z.string().min(1).optional(),
  origin: z.enum(CUE_ORIGINS),
  evidenceIds,
});

/**
 * The prize wheel at the table: a physical tabletop wheel the store already owns, so the plan says
 * what goes on each slice, and the UI prints the labels. Promo slices quote the
 * manager's promo exactly, terms included (origin "yours"), so a slice never promises more than the
 * store offers. Gift-card slices come from places on the block Qloo ranks (with receipts). Spinning
 * is free and needs no purchase.
 */
export const wheelSliceSchema = z
  .strictObject({
    /** What's printed on the slice, short. */
    label: z.string().min(1).max(40),
    kind: z.enum(["promo", "gift_card", "snack", "other"]),
    /** The full line: for a promo, the manager's text verbatim. */
    text: z.string().min(1).max(160),
    origin: z.enum(CUE_ORIGINS),
    refs: z.array(z.string().min(1)),
    evidenceIds,
  })
  .superRefine((slice, ctx) => {
    if (slice.kind === "promo" && slice.origin !== "yours") ctx.addIssue({ code: "custom", message: "a promo slice quotes the manager's promo (origin yours)", path: ["origin"] });
    if ((slice.origin === "qloo" || slice.origin === "interpreted") && slice.evidenceIds.length === 0) ctx.addIssue({ code: "custom", message: `a ${slice.origin} slice needs a Qloo receipt`, path: ["evidenceIds"] });
  });
export type WheelSlice = z.infer<typeof wheelSliceSchema>;

export const wheelSchema = z.strictObject({
  slices: z.array(wheelSliceSchema).min(4).max(12),
  /** "Free to spin, no purchase needed", "Promo slices show their terms", how gift cards are handed out. */
  rules: z.array(z.string().min(1).max(200)).min(1),
});
export type Wheel = z.infer<typeof wheelSchema>;

export const planSchema = z.strictObject({
  /** The kept concept; the others stay collapsed with their scores. */
  conceptId: slug,
  concepts: z.array(conceptSchema).min(1).max(3),
  runOfShow: z.array(runOfShowStepSchema),
  shopping: z.array(shoppingItemSchema),
  /** Permits and sidewalk rules, carrier brand rules, staffing, cleanup. */
  checklist: z.array(z.string().min(1).max(200)),
  estimatedCostUsd: z.number().nonnegative(),
  /** The prize wheel, when the plan uses one. */
  wheel: wheelSchema.optional(),
});
export type Plan = z.infer<typeof planSchema>;

// --- The generic plan: the same inputs, no Qloo ------------------------------------------------

export const baselineSchema = z.strictObject({
  items: z.array(planItemSchema),
  /** Generic choices with no local signal behind them (balloons, a generic DJ, a "free phone" sign). */
  cliches: z.array(z.strictObject({ text: z.string().min(1), why: z.string().min(1) })),
  /** Qloo's read of the generic plan's music and food picks, scored in one call against this city. */
  check: z
    .strictObject({
      checkable: z.number().int().nonnegative(),
      belowMedian: z.number().int().nonnegative(),
      unverifiable: z.number().int().nonnegative(),
      evidenceIds,
    })
    .nullable(),
});
export type Baseline = z.infer<typeof baselineSchema>;

export const comparisonSchema = z.strictObject({
  /** Lines of the kept concept with a Qloo receipt, out of all its lines. */
  qlooBacked: z.strictObject({ items: z.number().int().nonnegative(), of: z.number().int().nonnegative() }),
  baselineCliches: z.number().int().nonnegative(),
  /** Plain sentences for the side-by-side view. */
  lines: z.array(z.string().min(1)),
});
export type Comparison = z.infer<typeof comparisonSchema>;

// --- Marketing: the poster and the posts ----------------------------------------------------

export const posterSchema = z.strictObject({
  status: z.enum(["none", "queued", "ready", "failed", "skipped"]),
  /** Frozen at render time; no logos, no real people, no artist names. */
  prompt: z.string(),
  promptHash: z.string(),
  url: z.url().optional(),
  alt: z.string(),
  /** Why it is skipped or failed, in plain words ("Posters paused today"). */
  reason: z.string().optional(),
});
export type Poster = z.infer<typeof posterSchema>;

/** Drafts the manager reviews and shares. Nothing posts on its own. */
export const postsSchema = z.strictObject({
  facebook: z.strictObject({ text: z.string().min(1).max(2000) }),
  instagram: z.strictObject({ caption: z.string().min(1).max(2200), hashtags: z.array(z.string().min(1)).max(30) }),
  whatsapp: z.strictObject({ text: z.string().min(1).max(1000) }),
  share: z.strictObject({ facebook: z.url().optional(), whatsapp: z.url().optional() }),
});
export type Posts = z.infer<typeof postsSchema>;

// --- A/B test: two strategies, compared fairly --------------------------------------------------

export const TEST_METRICS = ["walk_ins", "sales", "activations"] as const;
export const VARIANTS = ["a", "b"] as const;

/**
 * A fair test of two strategies: two stores on the same day, or one store on two days. The rule is
 * written before the test runs, and each result is read against that store's usual day. One weekend
 * is a first look, not proof, and the report always says so.
 */
export const abTestSchema = z.strictObject({
  variants: z
    .array(
      z.strictObject({
        id: z.enum(VARIANTS),
        label: z.string().min(1).max(60),
        /** A concept from this plan, the generic AI plan, or the store's usual event. */
        source: z.enum(["concept", "generic", "usual"]),
        conceptId: slug.optional(),
      }),
    )
    .length(2),
  assignments: z.array(z.strictObject({ storeId: slug, date: z.iso.date(), variant: z.enum(VARIANTS) })).min(2),
  metric: z.enum(TEST_METRICS),
  decisionRule: z.string().min(1).max(240),
  caveat: z.string().min(1).max(240),
});
export type AbTest = z.infer<typeof abTestSchema>;

// --- After the event ---------------------------------------------------------------------------

export const resultsSchema = z.strictObject({
  loggedAt: z.iso.datetime(),
  /** Which side of the A/B test this result belongs to, when the plan has one. */
  variant: z.enum(VARIANTS).optional(),
  storeId: slug.optional(),
  walkIns: z.number().int().nonnegative().nullable(),
  sales: z.number().int().nonnegative().nullable(),
  posted: z.strictObject({ facebook: z.boolean(), instagram: z.boolean(), whatsapp: z.boolean() }),
  notes: z.string().max(280).optional(),
});
export type Results = z.infer<typeof resultsSchema>;

// --- Trace and stats ---------------------------------------------------------------------------

/** Pipeline stages, in progress-rail order. */
export const PLAN_STAGES = ["store", "city", "block", "concepts", "plan", "baseline", "marketing"] as const;
export type PlanStage = (typeof PLAN_STAGES)[number];
export const planStageSchema = z.enum(PLAN_STAGES);

export const traceStepSchema = z.strictObject({
  stage: planStageSchema,
  kind: z.enum(["tool", "decision"]),
  /** Human label, e.g. "Finding food spots within 1.5 km of the store". */
  label: z.string().min(1),
  reason: z.string().optional(),
  evidenceId: z.string().optional(),
  cached: z.boolean().optional(),
});
export type PlanTraceStep = z.infer<typeof traceStepSchema>;

// --- The report ------------------------------------------------------------------------------

const planReportShape = z.strictObject({
  version: z.literal(PLAN_VERSION),
  meta: z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["live", "example"]),
    createdAt: z.iso.datetime(),
    provenance: z.enum(["live", "recorded", "partial"]),
  }),
  inputs: inputsSchema,
  ledger: z.array(evidenceSchema),
  local: localSchema,
  plan: planSchema.nullable(),
  baseline: baselineSchema.nullable(),
  comparison: comparisonSchema.nullable(),
  poster: posterSchema,
  posts: postsSchema.nullable(),
  /** The A/B test plan, when the manager asks for one. */
  test: abTestSchema.nullable(),
  /** Every logged result, oldest first; the next plan reads them. */
  results: z.array(resultsSchema),
  trace: z.array(traceStepSchema),
  stats: z.strictObject({ stages: z.partialRecord(planStageSchema, stageStatsSchema) }),
  partial: z.strictObject({ stage: planStageSchema, reason: z.string().min(1) }).nullable(),
  /** Live runs only. Null for recorded examples. */
  cost: costSchema.nullable(),
});

/** Every evidence id anywhere in a value (evidenceIds arrays and single evidenceId fields). */
function cited(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => cited(v, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidenceIds" && Array.isArray(child)) found.push(...child.filter((id): id is string => typeof id === "string"));
      else if (key === "evidenceId" && typeof child === "string") found.push(child);
      else cited(child, found);
    }
  }
  return found;
}

/**
 * A plan report is valid only when every receipt it cites is in its ledger, the kept concept is one of
 * its concepts, and every ref and partner points at an artist or place Qloo returned in this run.
 */
export const planReportSchema = planReportShape.superRefine((report, ctx) => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
  const ledger = new Set(report.ledger.map((e) => e.id));
  for (const id of new Set(cited({ local: report.local, plan: report.plan, baseline: report.baseline, trace: report.trace }))) {
    if (!ledger.has(id)) issue(`cites ${id}, which is not in the ledger`, ["ledger"]);
  }
  const known = new Set<string>([...(report.local.city?.artists.map((a) => a.id) ?? []), ...(report.local.block?.places.map((p) => p.id) ?? [])]);
  const places = new Set(report.local.block?.places.map((p) => p.id) ?? []);
  if (report.plan) {
    const ids = report.plan.concepts.map((c) => c.id);
    if (!ids.includes(report.plan.conceptId)) issue(`kept concept ${report.plan.conceptId} is not one of the concepts`, ["plan", "conceptId"]);
    if (report.plan.concepts.filter((c) => c.kept).length !== 1) issue("exactly one concept is kept", ["plan", "concepts"]);
    report.plan.concepts.forEach((concept, c) =>
      concept.items.forEach((item, i) => item.refs.forEach((ref) => !known.has(ref) && issue(`ref ${ref} is not an artist or place from this run`, ["plan", "concepts", c, "items", i, "refs"]))),
    );
    report.plan.shopping.forEach((s, i) => s.from && !places.has(s.from) && issue(`shopping item buys from ${s.from}, which is not a block place`, ["plan", "shopping", i, "from"]));
  }
  report.test?.variants.forEach((v, i) => {
    if (v.source === "concept" && !(v.conceptId && report.plan?.concepts.some((c) => c.id === v.conceptId))) issue(`test variant ${v.id} runs a concept that is not in the plan`, ["test", "variants", i]);
  });
  report.baseline?.items.forEach((item, i) => {
    if (item.origin !== "creative") issue("the generic plan has no Qloo and no manager choices: every item is creative", ["baseline", "items", i, "origin"]);
  });
});
export type PlanReport = z.infer<typeof planReportShape>;
