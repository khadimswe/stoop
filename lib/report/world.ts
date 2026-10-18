// The concept worlds: what Gate 4 adds to the Report for each measured segment (its Culture Brief,
// the check against the frozen panels, the Creative Director's concepts, the Production Pack and the
// kit), plus the LLM-only Control scored against every world and the with-vs-without comparison.
// Part of the Report contract (lib/report/schema.ts): it changes only through its own pull request.
// The honesty rules live here as checks, not just comments: no median under 5 panel items, no Qloo
// or interpreted cue without a receipt, a field's signal agrees with its sources, and every count in
// a fit line is the count of its choices.
import { z } from "zod";
import { briefSlotsSchema, conceptSchema } from "../prompts/brief";
import { productionPackSchema } from "../prompts/pack";
import { rubricScoreSchema } from "../prompts/rubric";
import { AGE_BUCKETS } from "../qloo/constants";
import { MIN_PANEL_FOR_MEDIAN } from "../qloo/lift";
import { CULTURE_FIELDS, cueSchema, SIGNALS } from "../types";
import { partialSchema, stageSchema, stageStatsSchema } from "./stages";

export { MIN_PANEL_FOR_MEDIAN };

const evidenceIds = z.array(z.string().regex(/^ev_[0-9a-f]{12}$/));
const receipts = evidenceIds.min(1);
const segmentId = z.string().regex(/^[a-z0-9-]+$/);

/** The LLM-only Control's id wherever a segment id goes (its brief, its pack, its stage events). */
export const CONTROL_ID = "control";

/** A brief slot key, as lib/prompts/brief.ts briefCueTexts names them ("setting.0", "voice.tone"). */
export const BRIEF_SLOT = /^(?:productRole|mood|music|visual|voice\.tone|wardrobe|talent|setting\.[0-2])$/;
const briefSlot = z.string().regex(BRIEF_SLOT);

const statsSchema = z.partialRecord(stageSchema, stageStatsSchema);
const usageSchema = z.strictObject({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable() });

/**
 * Where a pick lands against the frozen reference panel in one scoring call: "beats 23 of 25
 * reference artists". `aboveMedian` is null when fewer than MIN_PANEL_FOR_MEDIAN panel items came back.
 */
export const panelPositionSchema = z
  .strictObject({
    beats: z.number().int().min(0),
    of: z.number().int().min(0),
    aboveMedian: z.boolean().nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.beats > p.of) ctx.addIssue({ code: "custom", message: `beats ${p.beats} of only ${p.of}`, path: ["beats"] });
    if (p.of < MIN_PANEL_FOR_MEDIAN && p.aboveMedian !== null) {
      ctx.addIssue({ code: "custom", message: `no median with ${p.of} panel items (fewer than ${MIN_PANEL_FOR_MEDIAN})`, path: ["aboveMedian"] });
    }
  });
export type PanelPosition = z.infer<typeof panelPositionSchema>;

// --- The Culture Brief ---------------------------------------------------------------------------

export { CULTURE_FIELDS, type CultureField } from "../types";

/** One Qloo item behind a field: an entity or tag this world's calls returned. */
export const cultureSourceSchema = z.strictObject({
  kind: z.enum(["entity", "tag"]),
  id: z.string().min(1),
  name: z.string().min(1),
  /** "urn:entity:movie", "urn:tag:genre:music", ... */
  type: z.string().min(1),
  /** Position in its own Qloo response (1 = Qloo's top pick there). */
  rank: z.number().int().min(1),
  /** Against the frozen panel, from the world's scoring call; null for types without a panel (places, people, podcasts). */
  position: panelPositionSchema.nullable(),
  /** Qloo's explainability for a place ("why it fits"), shown in the receipt. */
  why: z.array(z.string().min(1)).max(3),
  evidenceIds: receipts,
});
export type CultureSource = z.infer<typeof cultureSourceSchema>;

/** Sources a signal level needs at least: rich 3, thin 1, none 0 (the stage decides the level; this keeps it honest). */
export const SIGNAL_MIN_SOURCES = { rich: 3, thin: 1, none: 0 } as const;

export const cultureFieldSchema = z
  .strictObject({
    field: z.enum(CULTURE_FIELDS),
    /** rich: 3 or more sources beating 75% of the panel (or 3 distinct explained places); thin: 1 to 2; none: "No Qloo signal". */
    signal: z.enum(SIGNALS),
    /** "audience": measured for the whole taste neighborhood, not this segment (creators). */
    scope: z.enum(["segment", "audience"]),
    sources: z.array(cultureSourceSchema),
    /** The brief's wording for this field. With no signal it is empty ("No Qloo signal") or a creative suggestion. */
    cues: z.array(cueSchema).max(3),
  })
  .superRefine((f, ctx) => {
    if (f.sources.length < SIGNAL_MIN_SOURCES[f.signal]) {
      ctx.addIssue({ code: "custom", message: `a ${f.signal} field needs at least ${SIGNAL_MIN_SOURCES[f.signal]} sources, has ${f.sources.length}`, path: ["signal"] });
    }
    if (f.signal === "none" && f.sources.length > 0) ctx.addIssue({ code: "custom", message: "a field with no signal lists sources", path: ["sources"] });
    if (f.signal === "none" && f.cues.some((c) => c.origin === "qloo" || c.origin === "interpreted")) {
      ctx.addIssue({ code: "custom", message: "a field with no Qloo signal can only carry a creative suggestion or your choice", path: ["cues"] });
    }
  });
export type CultureFieldResult = z.infer<typeof cultureFieldSchema>;

/** The city a world's settings come from: one of the audience's top stable cities (lib/stages/culture.ts). */
export const settingCitySchema = z.strictObject({
  label: z.string().min(1),
  /** The verified Qloo locality the place call was anchored on. */
  localityId: z.string().min(1),
  /** Its rank among the audience's cities (Prove). */
  audienceRank: z.number().int().min(1),
  evidenceIds: receipts,
});
export type SettingCity = z.infer<typeof settingCitySchema>;

// --- The check -----------------------------------------------------------------------------------

/** One pick in a world's scoring calls: Qloo's own, or the LLM-only Control's (resolved to a Qloo id). */
export const scoredPickSchema = z.strictObject({
  from: z.enum(["qloo", "control"]),
  kind: z.enum(["entity", "tag"]),
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  /** Null when Qloo returned no score for it: "no measurable affinity", never "unsupported". */
  position: panelPositionSchema.nullable(),
  evidenceIds: receipts,
});
export type ScoredPick = z.infer<typeof scoredPickSchema>;

/** The Control choices a check can test. Setting types and wardrobe text map to no Qloo id: unverifiable. */
export const CONTROL_DIMENSIONS = ["age", "cities", "music", "mood", "reference", "setting", "wardrobe"] as const;
export type ControlDimension = (typeof CONTROL_DIMENSIONS)[number];

/**
 * How one Control choice fared in one world.
 *   supported     at or above the world's reference median (or a city in its top 10, an age band it over-indexes on)
 *   below         below the median: a cliche this data does not support
 *   missing       Qloo returned no score for it ("no measurable affinity"): checkable, but not counted as below
 *   unverifiable  nothing to check it against (no matching tag, setting types, wardrobe text, or a panel under 5)
 */
export const CHOICE_STATUSES = ["supported", "below", "missing", "unverifiable"] as const;

export const controlChoiceSchema = z
  .strictObject({
    dimension: z.enum(CONTROL_DIMENSIONS),
    /** The Control's own words, e.g. "Austin" or "lo-fi hip hop". */
    text: z.string().min(1),
    status: z.enum(CHOICE_STATUSES),
    /** For a tag or reference: where it landed against the panel, e.g. "beats 4 of 25 reference music tags". */
    position: panelPositionSchema.nullable(),
    /** For a city: its rank among this world's cities ("#44 of 380"). */
    rank: z.strictObject({ rank: z.number().int().min(1), of: z.number().int().min(1) }).nullable(),
    /** What Qloo measured for this choice in words, e.g. "skews -0.18" for an age band; null when nothing was. */
    measured: z.string().min(1).nullable(),
    evidenceIds,
  })
  .superRefine((choice, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["status"] });
    const verdict = choice.status === "supported" || choice.status === "below";
    // A panel position decides the status: above the median supports, below it is a cliche, no median is unverifiable.
    if (choice.position) {
      const { aboveMedian } = choice.position;
      if (aboveMedian === null && choice.status !== "unverifiable") issue("a panel with no median makes the choice unverifiable");
      if (aboveMedian === true && choice.status !== "supported") issue("above the panel median is supported");
      if (aboveMedian === false && choice.status !== "below") issue("below the panel median is below");
    }
    if (verdict && !choice.position && !choice.rank && !choice.measured) issue(`a ${choice.status} choice needs what Qloo measured`);
    if (verdict && choice.evidenceIds.length === 0) ctx.addIssue({ code: "custom", message: `a ${choice.status} choice needs a receipt`, path: ["evidenceIds"] });
  });
export type ControlChoice = z.infer<typeof controlChoiceSchema>;

export const clicheSchema = z.strictObject({
  dimension: z.enum(CONTROL_DIMENSIONS),
  /** "A generic AI brief assumed lo-fi hip hop." */
  assumed: z.string().min(1),
  /** "This world's music tags put it at 4 of 25." */
  measured: z.string().min(1),
  evidenceIds: receipts,
});
export type Cliche = z.infer<typeof clicheSchema>;

export const worldCheckSchema = z.strictObject({
  picks: z.array(scoredPickSchema),
  cliches: z.array(clicheSchema),
});
export type WorldCheck = z.infer<typeof worldCheckSchema>;

// --- Concepts ------------------------------------------------------------------------------------

/**
 * One of the Creative Director's concepts, as ranked. `uses` lists the brief slots the concept says it
 * draws on ("setting.0", "music"); `verifiedUses` the ones code found in its text. Specificity is
 * bounded by that count, so the writer never only grades itself.
 */
export const rankedConceptSchema = z
  .strictObject({
    concept: conceptSchema,
    rubric: rubricScoreSchema,
    uses: z.array(briefSlot),
    verifiedUses: z.array(briefSlot),
    /** Rubric total after the specificity bound (6 to 30). */
    total: z.number().int().min(6).max(30),
    /** kept: the world's concept; ranked: shown collapsed with its scores; discarded: failed a hard gate. */
    status: z.enum(["kept", "ranked", "discarded"]),
  })
  .superRefine((c, ctx) => {
    const declared = new Set(c.uses);
    for (const slot of c.verifiedUses) {
      if (!declared.has(slot)) ctx.addIssue({ code: "custom", message: `verified ${slot}, which the concept never declared`, path: ["verifiedUses"] });
    }
  });
export type RankedConcept = z.infer<typeof rankedConceptSchema>;

export const conceptSetSchema = z
  .strictObject({
    best: rankedConceptSchema,
    others: z.array(rankedConceptSchema).max(2),
    modelId: z.string().min(1),
    usage: usageSchema,
  })
  .superRefine((set, ctx) => {
    if (set.best.status !== "kept") ctx.addIssue({ code: "custom", message: "the best concept must be the kept one", path: ["best", "status"] });
    set.others.forEach((other, i) => {
      if (other.status === "kept") ctx.addIssue({ code: "custom", message: "only the best concept is kept", path: ["others", i, "status"] });
    });
  });
export type ConceptSet = z.infer<typeof conceptSetSchema>;

// --- The kit -------------------------------------------------------------------------------------

/** Short-form formats (lib/prompts/ugc/): Meta-friendly ones, then TikTok hooks. No testimonial format. */
export const UGC_FORMATS = ["product_demo", "before_after", "founder_story", "problem_solution", "pov", "unboxing", "first_try"] as const;
export type UgcFormat = (typeof UGC_FORMATS)[number];
export const AD_PLATFORMS = ["meta", "tiktok"] as const;
/** Where a script is meant to go: an AI UGC-actor tool, or a human creator. */
export const SCRIPT_TOOLS = ["arcads", "creatify", "creator"] as const;

export const ugcScriptSchema = z.strictObject({
  format: z.enum(UGC_FORMATS),
  platform: z.enum(AD_PLATFORMS),
  tool: z.enum(SCRIPT_TOOLS),
  /** Spoken as the brand, never as a customer who "tried it". */
  script: z.string().min(1),
  cta: z.string().min(1),
});
export type UgcScript = z.infer<typeof ugcScriptSchema>;

/** One ad set (Meta) or ad group (TikTok) per world: grouped by concept world, geo only where a campaign allows it. */
export const adPlanEntrySchema = z.strictObject({
  name: z.string().min(1),
  /** Optional geo and age options, never a promise of reach. */
  ageBands: z.array(z.enum(AGE_BUCKETS)),
  cities: z.array(z.string().min(1)),
  /** What to watch, tied to the kept concept's test hypothesis. */
  watch: z.string().min(1),
  /** "Targeting suggestions from aggregate taste data." */
  note: z.string().min(1),
  evidenceIds: receipts,
});
export type AdPlanEntry = z.infer<typeof adPlanEntrySchema>;

export const creatorBriefSchema = z.strictObject({
  /** The kind of creator to recruit, from Qloo person and podcast affinities (interpreted). Never a likeness. */
  profile: cueSchema,
  hooks: z.array(z.string().min(1)).max(3),
  hit: z.array(z.string().min(1)).max(6),
  avoid: z.array(z.string().min(1)).max(6),
  /** #ad and FTC disclosure rules. */
  disclosure: z.string().min(1),
});
export type CreatorBrief = z.infer<typeof creatorBriefSchema>;

export const kitSchema = z.strictObject({
  /** WebVTT captions for the kept concept's voiced or captioned scenes; null when it has none. */
  captions: z.string().startsWith("WEBVTT").nullable(),
  ugc: z.array(ugcScriptSchema),
  adPlan: adPlanEntrySchema.nullable(),
  creatorBrief: creatorBriefSchema.nullable(),
});
export type Kit = z.infer<typeof kitSchema>;

// --- Frames and revisions (after the run) ----------------------------------------------------------

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

/** One storyboard frame for a scene of the kept concept: the first render, or the re-render after the critique. */
export const frameSchema = z.strictObject({
  /** Index into the kept concept's scenes. */
  scene: z.number().int().min(0),
  url: z.url({ protocol: /^https$/ }),
  promptHash: hex64,
  /** The image model's id as its vendor names it, e.g. a fal endpoint. */
  modelId: z.string().regex(/^[a-z0-9][a-z0-9./-]{0,99}$/),
  /** 1: the first render; 2: the re-render after the critique. */
  attempt: z.union([z.literal(1), z.literal(2)]),
});
export type Frame = z.infer<typeof frameSchema>;

/** Claude's review of one frame against the critique checklist, the concept and the brief. */
export const frameCritiqueSchema = z.strictObject({
  scene: z.number().int().min(0),
  /** Concrete issues, e.g. "product hidden", "setting reads generic". Empty when the frame passes. */
  issues: z.array(z.string().min(1)).max(6),
  /** The rewritten prompt when the frame is re-rendered, else null. */
  rewrite: z.string().min(1).nullable(),
});
export type FrameCritique = z.infer<typeof frameCritiqueSchema>;

const revisionId = z.string().regex(/^rev-[0-9a-f]{12}$/);

export const worldFramesSchema = z.strictObject({
  /** The pack these frames render: null for the world's own pack, else the revision's, so frames never sit next to a pack they did not come from. */
  revisionId: revisionId.nullable(),
  /** rendering: in progress; done: frames and critique in; paused: the daily frame cap (or no frame service); failed: see reason. */
  status: z.enum(["rendering", "done", "paused", "failed"]),
  reason: z.string().min(1).nullable(),
  frames: z.array(frameSchema),
  critiques: z.array(frameCritiqueSchema),
});
export type WorldFrames = z.infer<typeof worldFramesSchema>;

/** One "Not this vibe" revision of a world: what was rejected, what changed, and the new brief, concepts and pack. */
export const revisionSchema = z.strictObject({
  /** "rev-" plus 12 hex. A revision runs as its own child run, with its own Qloo cap. */
  id: revisionId,
  field: z.union([z.enum(CULTURE_FIELDS), z.literal("world")]),
  /** The founder's note, guardrailed, shown as their words. Null when they gave none. */
  reason: z.string().min(1).max(280).nullable(),
  /** Qloo entity or tag ids the founder rejected (from this world's sources); the agent may not cite them again. */
  excluded: z.array(z.string().min(1)),
  changes: z.array(z.strictObject({ slot: briefSlot, before: cueSchema.nullable(), after: cueSchema.nullable() })),
  brief: briefSlotsSchema,
  culture: z.array(cultureFieldSchema),
  richSlots: z.array(briefSlot),
  concepts: conceptSetSchema.nullable(),
  pack: productionPackSchema.nullable(),
  /** The Campaign Kit rebuilt from the new pack. The setting city stays: it comes from the audience's cities, not the brief. */
  kit: kitSchema.nullable(),
  evidenceIds,
});
export type Revision = z.infer<typeof revisionSchema>;

// --- A world -------------------------------------------------------------------------------------

/**
 * One concept world, filled in as its stages land (check, then culture, then concepts, then pack).
 * A finished run has every part; a world that stopped early says where in `partial` and shows what
 * arrived, while the other worlds go on.
 */
export const worldSchema = z.strictObject({
  segmentId,
  label: z.string().min(1),
  settingCity: settingCitySchema.nullable(),
  check: worldCheckSchema.nullable(),
  culture: z.array(cultureFieldSchema).nullable(),
  brief: briefSlotsSchema.nullable(),
  /** Brief slots Qloo backed richly: a pack that drops one fails its check. */
  richSlots: z.array(briefSlot),
  concepts: conceptSetSchema.nullable(),
  pack: productionPackSchema.nullable(),
  kit: kitSchema.nullable(),
  /** This world's own stage timings and calls (world-scoped stages only). */
  stats: statsSchema,
  partial: partialSchema.nullable(),
  /** Storyboard frames, rendered after the run in their own invocation; null until requested. */
  frames: worldFramesSchema.nullable(),
  /** "Not this vibe" revisions, oldest first. */
  revisions: z.array(revisionSchema),
});
export type World = z.infer<typeof worldSchema>;

// --- The Control and the comparison --------------------------------------------------------------

/** One Control choice mapped to Qloo: a tag (music, mood) or an entity (a named reference), or nothing. */
export const controlMappingSchema = z.strictObject({
  dimension: z.enum(CONTROL_DIMENSIONS),
  text: z.string().min(1),
  ref: z.strictObject({ kind: z.enum(["entity", "tag"]), id: z.string().min(1), name: z.string().min(1), type: z.string().min(1) }).nullable(),
  /** "exact" or "affix" for names, the word similarity for tags. */
  match: z.union([z.enum(["exact", "affix"]), z.number().min(0).max(1)]).nullable(),
  evidenceIds,
});
export type ControlMapping = z.infer<typeof controlMappingSchema>;

/**
 * How the Control fits one world: "4 of 7 checkable LLM-only choices below this audience's reference
 * median (2 unverifiable)". Checkable = supported + below + missing; every count is the count of its
 * choices. `range` spans the 3 recorded Control runs for examples; null for live runs.
 */
export const controlFitSchema = z
  .strictObject({
    segmentId,
    choices: z.array(controlChoiceSchema),
    checkable: z.number().int().min(0),
    below: z.number().int().min(0),
    missing: z.number().int().min(0),
    unverifiable: z.number().int().min(0),
    line: z.string().min(1),
    range: z.strictObject({ runs: z.number().int().min(2), belowMin: z.number().int().min(0), belowMax: z.number().int().min(0) }).nullable(),
  })
  .superRefine((fit, ctx) => {
    const count = (status: (typeof CHOICE_STATUSES)[number]) => fit.choices.filter((c) => c.status === status).length;
    const expected = { below: count("below"), missing: count("missing"), unverifiable: count("unverifiable"), checkable: fit.choices.length - count("unverifiable") };
    for (const [key, value] of Object.entries(expected) as [keyof typeof expected, number][]) {
      if (fit[key] !== value) ctx.addIssue({ code: "custom", message: `${key} is ${fit[key]}, but the choices give ${value}`, path: [key] });
    }
    if (fit.range && fit.range.belowMin > fit.range.belowMax) ctx.addIssue({ code: "custom", message: "the range runs backwards", path: ["range"] });
  });
export type ControlFit = z.infer<typeof controlFitSchema>;

export const controlSchema = z.strictObject({
  /** Which of the 3 recorded Control runs (always 1, fixed in advance). */
  run: z.number().int().min(1),
  brief: briefSlotsSchema,
  /** What the generic brief assumed, in Qloo's dimensions. */
  assumed: z.strictObject({ ageBands: z.array(z.enum(AGE_BUCKETS)), cities: z.array(z.string().min(1)) }),
  mappings: z.array(controlMappingSchema),
  /** In world order. */
  fits: z.array(controlFitSchema),
  concepts: conceptSetSchema.nullable(),
  pack: productionPackSchema.nullable(),
  kit: kitSchema.nullable(),
  stats: statsSchema,
  partial: partialSchema.nullable(),
});
export type Control = z.infer<typeof controlSchema>;

export const comparisonSchema = z.strictObject({
  /** One line for the panel head, e.g. "The generic brief missed both worlds on music and cities." */
  headline: z.string().min(1),
  worlds: z.array(
    z.strictObject({
      segmentId,
      /** The Control's fit line for this world. */
      control: z.string().min(1),
      /** Qloo's picks for this world, e.g. "Qloo's music picks beat a median 23 of 25 reference artists". */
      qloo: z.string().min(1),
      cliches: z.number().int().min(0),
      evidenceIds: receipts,
    }),
  ),
});
export type Comparison = z.infer<typeof comparisonSchema>;
