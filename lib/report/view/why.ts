// Why it works: the receipts half of the report. The seeds Qloo measured from (with their origins),
// the Reality Check by dimension, the taste neighborhood (skews, taste tags, cities by lift), the
// Culture Brief per world with each cue's origin and receipt, and the scored comparison against the
// LLM-only Control. Every sentence a stage wrote is passed through verbatim; the few new words here
// (labels, panel positions) come from tested formatters. Every Qloo fact carries its receipt.
import { MIN_PANEL_FOR_MEDIAN } from "../../qloo/lift";
import { AGE_BUCKETS } from "../../qloo/constants";
import { ageBandLabel, CULTURE_FIELDS, type Cue, type CueOrigin, type CultureField, type Signal } from "../../types";
import type { DimensionCheck, Report, TraceStep } from "../schema";
import type { ControlChoice, CultureFieldResult, Revision, World } from "../world";
import { currentWorld } from "./current";
import { plainType, skewText } from "./format";
import { rankText, receiptView, receiptWithSources, type Ledger } from "./receipts";
import type { PartialView, ReceiptView } from "./types";

// --- Seeds and cities ---------------------------------------------------------------------------------

export interface SeedView {
  name: string;
  /** The Qloo type in plain words, e.g. "brand", "tv show", "tag". */
  kind: string;
  origin: "qloo" | "suggested" | "you";
  /** "affix": Qloo lists it under a longer name (the receipt says so). */
  match: "exact" | "affix" | null;
  receipt: ReceiptView | null;
}

export interface CityView {
  label: string;
  /** Rank by reference-corrected lift, among all of the audience's cities. */
  rank: number;
  /** "ranked against 22 reference audiences". */
  comparedWith: number;
  receipt: ReceiptView | null;
}

// --- The Reality Check, by dimension ----------------------------------------------------------------

export interface DimensionView {
  dimension: DimensionCheck["dimension"];
  label: string;
  /** What the founder (or their site) said, in Qloo's dimensions; null when not stated. */
  stated: string | null;
  statedBy: "You" | "Read from your site" | null;
  /** The gap stage's words for what Qloo measured, verbatim. */
  measured: string;
  outcome: DimensionCheck["outcome"];
  /** "Gap", "Near tie", "Confirmed", "Unverifiable", "Not stated": a near tie is never a gap. */
  outcomeLabel: string;
  /** Taste only: where the stated tag lands against the reference tag panel. */
  position: string | null;
  receipt: ReceiptView | null;
}

// --- The taste neighborhood ---------------------------------------------------------------------------

/** One skew bar: a relative index from -1 to 1 ("skews +0.21"), never a share of anyone. */
export interface SkewBarView {
  key: string;
  label: string;
  skew: number;
  text: string;
  /** |skew| on the bar's half scale, 0 to 100. */
  magnitude: number;
}

export interface DemographicsView {
  age: SkewBarView[];
  gender: SkewBarView[];
  receipt: ReceiptView | null;
}

export interface TasteTagView {
  id: string;
  name: string;
  /** "music" (genre tags) or "tone" (mood tags). */
  kind: "music" | "tone";
  /** Within its own response only: never compared across calls. */
  rank: number;
  receipt: ReceiptView | null;
}

// --- Culture Briefs -----------------------------------------------------------------------------------

export interface CueView {
  text: string;
  origin: CueOrigin;
  receipt: ReceiptView | null;
  /** After a revision: the cue it replaced, with its old receipt ("was: <old text> (Qloo receipt)"). */
  was: { text: string; origin: CueOrigin; receipt: ReceiptView | null } | null;
}

export interface CultureFieldView {
  field: CultureField;
  label: string;
  signal: Signal;
  /** "Rich Qloo signal", "Thin Qloo signal", "No Qloo signal". */
  signalLabel: string;
  /** Creators are measured for the whole taste neighborhood, not this world: the line says so. */
  scopeNote: string | null;
  cues: CueView[];
  /** True when nothing here came from Qloo: the row reads "No Qloo signal". */
  noSignal: boolean;
  sources: number;
  /** "Not this vibe" leaves these Qloo picks out of the new take: the field's own sources, at most the request's limit. */
  excludeIds: string[];
}

export interface RevisionChangeView {
  slot: string;
  label: string;
  before: CueView | null;
  after: CueView | null;
}

export interface RevisionView {
  id: string;
  field: Revision["field"];
  /** "Music feel", or "The whole world". */
  fieldLabel: string;
  /** The founder's note, shown as their words. */
  note: string | null;
  /** How many of Qloo's picks the founder turned down (left out of the new pick). */
  excluded: number;
  changes: RevisionChangeView[];
}

/** One agent decision from the trace, in its own words. */
export interface TraceStepView {
  label: string;
  reason: string | null;
}

export interface CultureBriefView {
  segmentId: string;
  label: string;
  /** The revision on show (the newest with a pack), or null for the world's own brief. */
  revisionId: string | null;
  fields: CultureFieldView[];
  /** Oldest first. */
  revisions: RevisionView[];
  /** The latest revision job's own trace steps (live reports), so progress and failures show. */
  reviseSteps: TraceStepView[];
  /** A finished brief and pack: what "Not this vibe" needs. */
  revisable: boolean;
  partial: PartialView | null;
}

// --- With vs without Qloo -----------------------------------------------------------------------------

export interface ChoiceView {
  dimension: ControlChoice["dimension"];
  dimensionLabel: string;
  /** The Control's own words. */
  text: string;
  status: ControlChoice["status"];
  /** "Supported", "Cliche flagged" (below the median), "No measurable affinity", "Unverifiable". */
  statusLabel: string;
  /** What Qloo measured for it, verbatim; null when there was nothing to check it against. */
  measured: string | null;
  receipt: ReceiptView | null;
}

export interface ClicheView {
  dimension: ControlChoice["dimension"];
  assumed: string;
  measured: string;
  receipt: ReceiptView | null;
}

export interface ScoreWorldView {
  segmentId: string;
  label: string;
  /** The stage's scoreboard sentence, verbatim. */
  fitLine: string;
  fitReceipt: ReceiptView | null;
  counts: { checkable: number; below: number; missing: number; unverifiable: number };
  /** Examples: the spread over the recorded Control runs. Null for live runs. */
  range: string | null;
  /** Qloo's own picks against the same panels, verbatim. */
  qlooLine: string | null;
  qlooReceipt: ReceiptView | null;
  /** The choices by dimension, each group with the rule the check applied to it. */
  groups: ChoiceGroupView[];
  cliches: ClicheView[];
}

export interface ChoiceGroupView {
  key: string;
  title: string;
  /** How the check decided these choices, in plain words (lib/stages/check.ts). */
  rule: string;
  choices: ChoiceView[];
}

export interface ScoreboardView {
  headline: string | null;
  worlds: ScoreWorldView[];
}

export interface WhyView {
  seeds: SeedView[];
  /**
   * The audience's cities by lift, stable ones only: a city flagged as swinging between the
   * reference sets is left out, as the Reality Check leaves it out (lib/stages/gap.ts).
   */
  cities: CityView[];
  comparisonHeadline: string | null;
  /** Honest caveats from Prove: "thin-heatmap", "few-seeds". */
  flags: string[];
  dimensions: DimensionView[];
  demographics: DemographicsView | null;
  tags: TasteTagView[];
  /** Cities that held only against the small reference set: never used as a setting. */
  smallSetOnly: string[];
  /** Cities left out because their rank swings between the reference sets. */
  swinging: string[];
  briefs: CultureBriefView[];
  scoreboard: ScoreboardView | null;
}

/** Stable cities shown at most. */
export const TOP_CITIES = 5;
/** Qloo ids a revision request may name (lib/api/requests.ts reviseRequestSchema caps exclude at 12). */
export const EXCLUDE_MAX = 12;
/** A generic city counts as supported inside this world's top cities by lift (lib/stages/check.ts CITY_SUPPORT_RANK). */
export const CITY_SUPPORT_RANK = 10;

export const FIELD_LABELS: Readonly<Record<CultureField, string>> = {
  music: "Music feel",
  visual: "Visual language",
  wardrobe: "Wardrobe",
  setting: "Setting",
  mood: "Mood",
  voice: "Voice",
  creators: "Creators",
};

const SIGNAL_LABELS: Readonly<Record<Signal, string>> = { rich: "Rich Qloo signal", thin: "Thin Qloo signal", none: "No Qloo signal" };

const OUTCOME_LABELS: Readonly<Record<DimensionCheck["outcome"], string>> = {
  gap: "Gap",
  near_tie: "Near tie",
  confirmed: "Confirmed",
  unverifiable: "Unverifiable",
  not_stated: "Not stated",
};

const DIMENSION_LABELS: Readonly<Record<DimensionCheck["dimension"], string>> = { age: "Age", gender: "Gender", cities: "Cities", taste: "Taste" };

export const STATUS_LABELS: Readonly<Record<ControlChoice["status"], string>> = {
  supported: "Supported",
  below: "Cliche flagged",
  missing: "No measurable affinity",
  unverifiable: "Unverifiable",
};

const CHOICE_LABELS: Readonly<Record<ControlChoice["dimension"], string>> = {
  age: "Age",
  cities: "City",
  music: "Music",
  mood: "Mood",
  reference: "Reference",
  setting: "Setting",
  wardrobe: "Wardrobe",
};

const SLOT_LABELS: Readonly<Record<string, string>> = {
  productRole: "Product role",
  mood: "Mood",
  music: "Music feel",
  visual: "Visual language",
  "voice.tone": "Voice",
  wardrobe: "Wardrobe",
  talent: "Talent",
};

/** "Setting 2" for "setting.1"; the slot's plain name otherwise. */
export function slotLabel(slot: string): string {
  const setting = /^setting\.(\d)$/.exec(slot);
  if (setting) return `Setting ${Number(setting[1]) + 1}`;
  return SLOT_LABELS[slot] ?? slot;
}

/** The Culture Brief field a brief slot belongs to, or null (product role and talent are not culture fields). */
export function fieldOfSlot(slot: string): CultureField | null {
  if (slot.startsWith("setting.")) return "setting";
  if (slot === "voice.tone") return "voice";
  return (CULTURE_FIELDS as readonly string[]).includes(slot) ? (slot as CultureField) : null;
}

// --- Builders -----------------------------------------------------------------------------------------

function seedViews(report: Report, ledger: Ledger): SeedView[] {
  const seeds = report.audience.proof?.seeds ?? report.inputs.seeds;
  return seeds.map((seed) => {
    const kind = plainType(seed.ref.type);
    const receipt = receiptView(ledger, seed.evidenceIds, "Seed", `${seed.ref.name} (${kind})`);
    if (receipt && seed.match === "affix") receipt.rows.unshift({ label: "Matched", value: "Qloo lists it under a longer name" });
    return { name: seed.ref.name, kind, origin: seed.origin, match: seed.match ?? null, receipt };
  });
}

function cityViews(report: Report, ledger: Ledger): CityView[] {
  return (report.audience.proof?.cities ?? [])
    .filter((city) => city.flags.length === 0)
    .slice(0, TOP_CITIES)
    .map((city) => ({
      label: city.label,
      rank: city.rank,
      comparedWith: city.comparedWith,
      receipt: receiptView(ledger, city.evidenceIds, "City", `${city.label}, #${city.rank} by lift, ranked against ${city.comparedWith} reference audiences`),
    }));
}

function dimensionViews(report: Report, ledger: Ledger): DimensionView[] {
  return (report.audience.gap?.dimensions ?? []).map((d) => {
    const position = d.position
      ? `${d.position.tag}: beats ${d.position.beats} of ${d.position.of} reference tags${d.position.of < MIN_PANEL_FOR_MEDIAN ? " (too few for a median)" : ""}`
      : null;
    return {
      dimension: d.dimension,
      label: DIMENSION_LABELS[d.dimension],
      stated: d.stated,
      statedBy: d.statedBy === "you" ? "You" : d.statedBy === "site" ? "Read from your site" : null,
      measured: d.measured,
      outcome: d.outcome,
      outcomeLabel: OUTCOME_LABELS[d.outcome],
      position,
      receipt: receiptView(ledger, d.evidenceIds, `Reality Check: ${DIMENSION_LABELS[d.dimension].toLowerCase()}`, d.measured),
    };
  });
}

const bar = (key: string, label: string, skew: number): SkewBarView => ({
  key,
  label,
  skew,
  text: skewText(skew),
  magnitude: Math.round(Math.min(1, Math.abs(skew)) * 100),
});

function demographicsView(report: Report, ledger: Ledger): DemographicsView | null {
  const proof = report.audience.proof;
  if (!proof) return null;
  const { age, gender, evidenceIds } = proof.demographics;
  return {
    // Adult labels only: the youngest bucket reads "18 to 24".
    age: AGE_BUCKETS.filter((bucket) => typeof age[bucket] === "number").map((bucket) => bar(bucket, ageBandLabel(bucket), age[bucket])),
    gender: [bar("female", "Female", gender.female), bar("male", "Male", gender.male)],
    receipt: receiptView(ledger, evidenceIds, "Age and gender skew", "Relative skews across the seeds, from -1 to 1. Skews, never shares."),
  };
}

function tagViews(report: Report, ledger: Ledger): TasteTagView[] {
  return (report.audience.proof?.tags ?? []).map((tag) => ({
    id: tag.id,
    name: tag.name,
    kind: tag.kind,
    rank: tag.rank,
    receipt: receiptView(ledger, tag.evidenceIds, tag.kind === "music" ? "Music tag" : "Mood tag", `${tag.name}, ${rankText(tag.rank)}`),
  }));
}

/** The brief and culture on show: the revision whose pack the kit shows, else the world's own. */
export function currentCulture(world: World): { revision: Revision | null; culture: CultureFieldResult[] | null } {
  const { revisionId } = currentWorld(world);
  const revision = revisionId ? (world.revisions.find((r) => r.id === revisionId) ?? null) : null;
  return { revision, culture: revision ? revision.culture : world.culture };
}

function cueView(ledger: Ledger, cue: Cue, label: string, sources: CultureFieldResult["sources"] = []): CueView {
  // The picks this cue cites, else every pick of its field.
  const cited = sources.filter((s) => s.evidenceIds.some((id) => cue.evidenceIds.includes(id)));
  const receipt = cue.origin === "qloo" || cue.origin === "interpreted" ? receiptWithSources(ledger, cue.evidenceIds, cited.length ? cited : sources, label, cue.text) : null;
  return { text: cue.text, origin: cue.origin, receipt, was: null };
}

function wasOf(ledger: Ledger, before: Cue, label: string): CueView["was"] {
  const fromQloo = before.origin === "qloo" || before.origin === "interpreted";
  return { text: before.text, origin: before.origin, receipt: fromQloo ? receiptView(ledger, before.evidenceIds, `Was: ${label}`, before.text) : null };
}

function fieldView(ledger: Ledger, field: CultureFieldResult, changes: Revision["changes"]): CultureFieldView {
  const label = FIELD_LABELS[field.field];
  const cues = field.cues.map((cue) => {
    const view = cueView(ledger, cue, label, field.sources);
    const change = changes.find((c) => fieldOfSlot(c.slot) === field.field && c.after?.text === cue.text && c.before);
    return change?.before ? { ...view, was: wasOf(ledger, change.before, label) } : view;
  });
  return {
    field: field.field,
    label,
    signal: field.signal,
    signalLabel: SIGNAL_LABELS[field.signal],
    scopeNote: field.scope === "audience" ? "Measured for the whole taste neighborhood, not only this world." : null,
    cues,
    noSignal: !field.cues.some((c) => c.origin === "qloo" || c.origin === "interpreted"),
    sources: field.sources.length,
    excludeIds: field.sources.slice(0, EXCLUDE_MAX).map((source) => source.id),
  };
}

function revisionView(ledger: Ledger, revision: Revision): RevisionView {
  return {
    id: revision.id,
    field: revision.field,
    fieldLabel: revision.field === "world" ? "The whole world" : FIELD_LABELS[revision.field],
    note: revision.reason,
    excluded: revision.excluded.length,
    changes: revision.changes.map((change) => {
      const label = slotLabel(change.slot);
      return {
        slot: change.slot,
        label,
        before: change.before && { ...cueView(ledger, change.before, `Was: ${label}`), was: null },
        after: change.after && cueView(ledger, change.after, label),
      };
    }),
  };
}

const stepView = (step: TraceStep): TraceStepView => ({ label: step.label, reason: step.reason ?? null });

/** The steps of a world's latest after-run job of one kind, from the job's first line on (all of them when there is none). */
export function latestJobSteps(trace: readonly TraceStep[], segmentId: string, stage: "frames" | "revise", startsWith?: string): TraceStepView[] {
  const steps = trace.filter((s) => s.stage === stage && s.segmentId === segmentId);
  const start = startsWith ? steps.findLastIndex((s) => s.label.startsWith(startsWith)) : -1;
  return steps.slice(Math.max(0, start)).map(stepView);
}

/**
 * How a requested revision went, read from the report: "done" once the revision is on its world,
 * "failed" with the agent's reason once a "Could not revise" step for that world lands after the
 * request (traceFrom: the trace's length when it was sent), else "pending".
 */
export function revisionOutcome(
  report: Pick<Report, "worlds" | "trace">,
  segmentId: string,
  revisionId: string | null,
  traceFrom: number,
): { status: "pending" } | { status: "done" } | { status: "failed"; reason: string } {
  const world = report.worlds.find((w) => w.segmentId === segmentId);
  if (revisionId && world?.revisions.some((r) => r.id === revisionId)) return { status: "done" };
  const failed = report.trace.slice(traceFrom).find((s) => s.stage === "revise" && s.segmentId === segmentId && s.label.startsWith("Could not revise"));
  return failed ? { status: "failed", reason: failed.reason ?? failed.label } : { status: "pending" };
}

function briefView(report: Report, ledger: Ledger, world: World): CultureBriefView {
  const { revision, culture } = currentCulture(world);
  const changes = revision?.changes ?? [];
  const order = new Map(CULTURE_FIELDS.map((f, i) => [f, i]));
  return {
    segmentId: world.segmentId,
    label: world.label,
    revisionId: revision?.id ?? null,
    fields: [...(culture ?? [])].sort((a, b) => (order.get(a.field) ?? 0) - (order.get(b.field) ?? 0)).map((field) => fieldView(ledger, field, changes)),
    revisions: world.revisions.map((r) => revisionView(ledger, r)),
    reviseSteps: latestJobSteps(report.trace, world.segmentId, "revise", "Revising "),
    revisable: world.brief !== null && world.pack !== null,
    partial: world.partial,
  };
}

function choiceView(ledger: Ledger, choice: ControlChoice): ChoiceView {
  return {
    dimension: choice.dimension,
    dimensionLabel: CHOICE_LABELS[choice.dimension],
    text: choice.text,
    status: choice.status,
    statusLabel: STATUS_LABELS[choice.status],
    measured: choice.measured,
    receipt: receiptView(ledger, choice.evidenceIds, `Generic choice: ${CHOICE_LABELS[choice.dimension].toLowerCase()}`, choice.measured ?? choice.text),
  };
}

/** The check's rule per kind of choice, as lib/stages/check.ts applies it. */
const CHOICE_GROUPS: readonly { key: string; title: string; dimensions: readonly ControlChoice["dimension"][]; rule: string }[] = [
  { key: "age", title: "Age", dimensions: ["age"], rule: "Flagged when the generic brief's age bands miss this world's band, from Qloo's demographics." },
  {
    key: "cities",
    title: "Cities",
    dimensions: ["cities"],
    rule: `Flagged when a city is outside this world's top ${CITY_SUPPORT_RANK} by lift on Qloo's heatmap. A city Qloo has no rank for has no measurable affinity.`,
  },
  {
    key: "taste",
    title: "Music, mood and references",
    dimensions: ["music", "mood", "reference"],
    rule: "Flagged when below this world's reference panel median, scored in one Qloo call. No score back: no measurable affinity. Under 5 panel items there is no median, so it stays unverifiable.",
  },
  { key: "unchecked", title: "Setting and wardrobe", dimensions: ["setting", "wardrobe"], rule: "Qloo has nothing to check these against, so they stay unverifiable." },
];

export function choiceGroups(ledger: Ledger, choices: readonly ControlChoice[]): ChoiceGroupView[] {
  return CHOICE_GROUPS.flatMap(({ key, title, dimensions, rule }) => {
    const group = choices.filter((c) => dimensions.includes(c.dimension));
    return group.length ? [{ key, title, rule, choices: group.map((c) => choiceView(ledger, c)) }] : [];
  });
}

function rangeText(range: { runs: number; belowMin: number; belowMax: number } | null): string | null {
  if (!range) return null;
  const spread = range.belowMin === range.belowMax ? `${range.belowMin}` : `${range.belowMin} to ${range.belowMax}`;
  return `Across ${range.runs} recorded generic briefs, ${spread} choices missed.`;
}

function scoreboardView(report: Report, ledger: Ledger): ScoreboardView | null {
  const control = report.control;
  if (!control || control.fits.length === 0) return null;
  const labels = new Map(report.worlds.map((w) => [w.segmentId, w.label]));
  const checks = new Map(report.worlds.map((w) => [w.segmentId, w.check]));
  return {
    headline: report.comparison?.headline ?? null,
    worlds: control.fits.map((fit) => {
      const line = report.comparison?.worlds.find((w) => w.segmentId === fit.segmentId) ?? null;
      return {
        segmentId: fit.segmentId,
        label: labels.get(fit.segmentId) ?? fit.segmentId,
        fitLine: fit.line,
        fitReceipt: receiptView(
          ledger,
          fit.choices.flatMap((c) => c.evidenceIds),
          "Generic brief vs Qloo",
          fit.line,
        ),
        counts: { checkable: fit.checkable, below: fit.below, missing: fit.missing, unverifiable: fit.unverifiable },
        range: rangeText(fit.range),
        qlooLine: line?.qloo ?? null,
        qlooReceipt: line ? receiptView(ledger, line.evidenceIds, "Qloo's own picks", line.qloo) : null,
        groups: choiceGroups(ledger, fit.choices),
        cliches: (checks.get(fit.segmentId)?.cliches ?? []).map((c) => ({
          dimension: c.dimension,
          assumed: c.assumed,
          measured: c.measured,
          receipt: receiptView(ledger, c.evidenceIds, "Cliche flagged", c.measured),
        })),
      };
    }),
  };
}

export function whyView(report: Report, ledger: Ledger): WhyView {
  const proof = report.audience.proof;
  return {
    seeds: seedViews(report, ledger),
    cities: cityViews(report, ledger),
    comparisonHeadline: report.comparison?.headline ?? null,
    flags: proof?.flags ?? [],
    dimensions: dimensionViews(report, ledger),
    demographics: demographicsView(report, ledger),
    tags: tagViews(report, ledger),
    smallSetOnly: (proof?.smallSetOnly ?? []).map((c) => c.label),
    swinging: (proof?.cities ?? []).filter((c) => c.flags.includes("large-swing")).map((c) => c.label),
    briefs: report.worlds.map((world) => briefView(report, ledger, world)),
    scoreboard: scoreboardView(report, ledger),
  };
}
