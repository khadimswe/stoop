// The Report: everything one run produces, the shape the UI renders for live runs, finished runs
// and example replays alike. It is the contract between the backend lane (stages) and the UI lane
// (report components), so it changes only through its own small pull request.
// Every audience fact carries evidence ids into `ledger`; no evidence, no display.
import { z } from "zod";
import { evidenceSchema } from "../evidence";
import { AGE_BUCKETS } from "../qloo/constants";
import { productSpecSchema } from "../prompts/brief";
import { creativeDirectionSchema } from "../types";
import { comparisonSchema, controlSchema, worldSchema } from "./world";

export const REPORT_VERSION = 1;

const evidenceIds = z.array(z.string().regex(/^ev_[0-9a-f]{12}$/));
const ageSkews = z.record(z.enum(AGE_BUCKETS), z.number().min(-1).max(1));

/** Pipeline stages, in progress-rail order. */
export const STAGES = ["prove", "gap", "segments", "culture", "concepts", "prompts", "score"] as const;
export type Stage = (typeof STAGES)[number];
export const stageSchema = z.enum(STAGES);

// --- Inputs ----------------------------------------------------------------------------------

/** Where a seed came from (separate from cue origins): Qloo tags, Claude suggestions that resolved, or the user. */
export const SEED_ORIGINS = ["qloo", "suggested", "you"] as const;

export const seedSchema = z.strictObject({
  ref: z.strictObject({
    kind: z.enum(["entity", "tag"]),
    id: z.string().min(1),
    name: z.string().min(1),
    /** "urn:entity:brand", "urn:tag:genre:music", ... */
    type: z.string().min(1),
  }),
  origin: z.enum(SEED_ORIGINS),
  /** How a typed or suggested name matched Qloo's search ("affix": Qloo lists it under a longer name). */
  match: z.enum(["exact", "affix"]).optional(),
  evidenceIds,
});
export type Seed = z.infer<typeof seedSchema>;

export const inputsSchema = z.strictObject({
  product: productSpecSchema,
  seeds: z.array(seedSchema),
  /** What the founder said about their customer, verbatim (quoted data, never instructions). */
  statedCustomer: z.string().nullable(),
  /** The region the founder gave, e.g. "United States" or "Texas". */
  region: z.string().min(1),
  direction: creativeDirectionSchema,
});
export type RunInputs = z.infer<typeof inputsSchema>;

// --- Audience: Prove -------------------------------------------------------------------------

export const tasteTagSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["music", "tone"]),
  /** Affinity within its own response; only compared inside that response. */
  affinity: z.number(),
  rank: z.number().int().min(1),
  evidenceIds,
});
export type TasteTag = z.infer<typeof tasteTagSchema>;

export const cityCueSchema = z.strictObject({
  /** Census metro name, e.g. "Baton Rouge, LA". */
  metro: z.string().min(1),
  /** The label used in copy and prompts, e.g. "Baton Rouge, LA". */
  label: z.string().min(1),
  rank: z.number().int().min(1),
  /** Mean reference-corrected lift of the metro's cells (see lib/geo/metros.ts). */
  lift: z.number(),
  cells: z.number().int().min(1),
  topCell: z.string().min(1),
  /** How many reference audiences the ranking compared against ("ranked against 22 reference audiences"). */
  comparedWith: z.number().int().min(1),
  /** Rank against the 9 candidate audiences alone, for the stability check. Null when outside that list. */
  candidateSetRank: z.number().int().min(1).nullable(),
  /**
   * "small-set-only": top 5 against the 9 candidates but not the top 10 against the full set.
   * "large-swing": its rank moves by more than 20 between the two sets (unstable either way).
   */
  flags: z.array(z.enum(["small-set-only", "large-swing"])),
  /**
   * "audience": where the whole taste neighborhood over-indexes (Prove). "age-band": a segment's
   * cities, which also reflect where that age band lives in general, so a setting hint only.
   */
  basis: z.enum(["audience", "age-band"]),
  evidenceIds,
});
export type CityCue = z.infer<typeof cityCueSchema>;

export const proofSchema = z.strictObject({
  /** "Qloo measured from these seeds": every seed with its origin. */
  seeds: z.array(seedSchema),
  demographics: z.strictObject({
    /** Mean skew index per age bucket across the seeds (-1 to 1). Skews, never shares. */
    age: ageSkews,
    gender: z.strictObject({ male: z.number(), female: z.number() }),
    perSeed: z.array(z.strictObject({ seedId: z.string(), age: ageSkews, gender: z.strictObject({ male: z.number(), female: z.number() }) })),
    evidenceIds,
  }),
  tags: z.array(tasteTagSchema),
  cities: z.array(cityCueSchema),
  /** The top 10 by lift (names and ranks), so a stated city at #6 to #10 reads as a near tie. */
  cityRanks: z.array(z.strictObject({ metro: z.string(), label: z.string(), rank: z.number().int().min(1), flags: z.array(z.enum(["small-set-only", "large-swing"])) })),
  /** Cities that ranked in the top 5 against the 9 candidate audiences but not the top 10 against the full set: shown as "held only against the small set", never used. */
  smallSetOnly: z.array(z.strictObject({ label: z.string(), candidateSetRank: z.number().int().min(1), fullRank: z.number().int().min(1).nullable() })),
  /** Share of the reference grid this heatmap covers (lib/geo/metros.ts gridCoverage). */
  coverage: z.number().min(0).max(1),
  flags: z.array(z.enum(["thin-heatmap", "few-seeds"])),
});
export type Proof = z.infer<typeof proofSchema>;

// --- Audience: the Reality Check ---------------------------------------------------------------

export const DIMENSIONS = ["age", "gender", "cities", "taste"] as const;
/** "unverifiable": stated, but Qloo returned no measurable affinity for it, which is not evidence either way. */
export const DIMENSION_OUTCOMES = ["gap", "near_tie", "confirmed", "unverifiable", "not_stated"] as const;
export const GAP_OUTCOMES = ["gap", "partly", "confirmed", "not_stated"] as const;

export const dimensionSchema = z.strictObject({
  dimension: z.enum(DIMENSIONS),
  /** What the founder (or their site) said, in Qloo's dimensions; null when not stated. */
  stated: z.string().nullable(),
  /** Where the input came from: the founder ("you") or "Read from your site" ("site"). */
  statedBy: z.enum(["you", "site"]).nullable(),
  measured: z.string().min(1),
  outcome: z.enum(DIMENSION_OUTCOMES),
  /** The margin the outcome rests on (age: skew difference; gender: skew strength; cities: rank); null when not stated. */
  margin: z.number().nullable(),
  /** Taste only: a stated tag's position against the reference tag panel ("your Soul - Funk beats 0 of 19"); the middle one when several. */
  position: z.strictObject({ tag: z.string().min(1), beats: z.number().int().min(0), of: z.number().int().min(0) }).nullable(),
  /** Age only: the stated band spans more than 25 years, so a match says little. */
  broad: z.boolean(),
  evidenceIds,
});
export type DimensionCheck = z.infer<typeof dimensionSchema>;

export const gapLineSchema = z.strictObject({
  kind: z.enum(["site", "stated", "generic", "measured", "near", "broad", "unverifiable", "confirmed", "unstated"]),
  text: z.string().min(1),
  evidenceIds,
});
export type GapLine = z.infer<typeof gapLineSchema>;

export const gapSchema = z.strictObject({
  /** gap: every stated dimension is a gap; confirmed: every one is confirmed; partly: anything between. */
  outcome: z.enum(GAP_OUTCOMES),
  dimensions: z.array(dimensionSchema),
  lines: z.array(gapLineSchema),
});
export type RealityCheck = z.infer<typeof gapSchema>;

// --- Audience: Segments ----------------------------------------------------------------------

export const entityRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  rank: z.number().int().min(1),
  affinity: z.number().nullable(),
  popularity: z.number().nullable(),
  evidenceIds,
});
export type EntityRef = z.infer<typeof entityRefSchema>;

export const segmentSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  bucket: z.enum(AGE_BUCKETS),
  /** Always an adult label: the youngest bucket shows as "18 to 24". */
  ageBand: z.string().min(1),
  skew: z.number(),
  /** Built only from what Qloo measured, e.g. "55 and older · rock and blues rock". */
  label: z.string().min(1),
  /** The most common primary genres of the segment's top artists (a Qloo property). */
  genres: z.array(z.string()),
  /**
   * Where this age band of the audience clusters. Includes an age effect (the reference audiences
   * have no age signal), so it is a setting hint, not a measured over-index like Proof's cities.
   */
  cities: z.array(cityCueSchema),
  artists: z.array(entityRefSchema),
  brands: z.array(entityRefSchema),
  evidenceIds,
});
export type Segment = z.infer<typeof segmentSchema>;

export const segmentsSchema = z.strictObject({
  items: z.array(segmentSchema),
  /** 1 minus the top-20 overlap of the two segments' artists and brands; null with one segment. */
  distinctness: z.number().nullable(),
  merged: z.boolean(),
});
export type Segments = z.infer<typeof segmentsSchema>;

// --- Trace and stats -------------------------------------------------------------------------

export const traceStepSchema = z.strictObject({
  stage: stageSchema,
  kind: z.enum(["tool", "decision"]),
  /** Human label, e.g. "Measuring age and gender skew from 4 seeds". */
  label: z.string().min(1),
  reason: z.string().optional(),
  evidenceId: z.string().optional(),
  cached: z.boolean().optional(),
  /** The concept world a step belongs to, when worlds run side by side. */
  segmentId: z.string().regex(/^[a-z0-9-]+$/).optional(),
});
export type TraceStep = z.infer<typeof traceStepSchema>;

export const stageStatsSchema = z.strictObject({
  durationMs: z.number().nonnegative(),
  liveCalls: z.number().int().nonnegative(),
  cachedCalls: z.number().int().nonnegative(),
});

// --- The report ------------------------------------------------------------------------------

const reportShape = z.strictObject({
  version: z.literal(REPORT_VERSION),
  meta: z.strictObject({
    id: z.string().min(1),
    kind: z.enum(["live", "example"]),
    createdAt: z.iso.datetime(),
    provenance: z.enum(["live", "recorded", "partial"]),
  }),
  inputs: inputsSchema,
  ledger: z.array(evidenceSchema),
  audience: z.strictObject({
    proof: proofSchema.nullable(),
    gap: gapSchema.nullable(),
    segments: segmentsSchema.nullable(),
  }),
  /** One concept world per segment (lib/report/world.ts), in segment order. */
  worlds: z.array(worldSchema),
  /** The LLM-only Control brief, scored against every world. */
  control: controlSchema.nullable(),
  comparison: comparisonSchema.nullable(),
  trace: z.array(traceStepSchema),
  stats: z.strictObject({ stages: z.partialRecord(stageSchema, stageStatsSchema) }),
  /** Set when the run stopped early; the report still shows what was measured. */
  partial: z.strictObject({ stage: stageSchema, reason: z.string() }).nullable(),
});

/** Every evidence id anywhere in a value (evidenceIds arrays and single evidenceId fields). */
export function citedEvidence(value: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "evidenceIds" && Array.isArray(child)) found.push(...child.filter((id): id is string => typeof id === "string"));
        else if (key === "evidenceId" && typeof child === "string") found.push(child);
        else walk(child);
      }
    }
  };
  walk(value);
  return found;
}

/** A report is valid only when every receipt it cites is in its ledger. No evidence, no display. */
export const reportSchema = reportShape.superRefine((report, ctx) => {
  const ledger = new Set(report.ledger.map((e) => e.id));
  const cited = citedEvidence({ inputs: report.inputs, audience: report.audience, worlds: report.worlds, control: report.control, comparison: report.comparison, trace: report.trace });
  for (const id of cited) {
    if (!ledger.has(id)) ctx.addIssue({ code: "custom", message: `cites ${id}, which is not in the ledger`, path: ["ledger"] });
  }
});
export type Report = z.infer<typeof reportShape>;
