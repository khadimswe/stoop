// "Results so far" on /run: what the run has measured and written, as it arrives. Every line is the
// stages' own words or a Qloo value with its receipt in the run's ledger; a part that has not arrived
// is null (the page shows a skeleton), never a guess.
import type { ReportState } from "../events";
import type { Evidence } from "../evidence";
import type { GapLine } from "../report/schema";
import type { CultureFieldResult } from "../report/world";
import type { CueOrigin } from "../types";
import { plainType, skewText } from "../report/view/format";
import { receiptView } from "../report/view/receipts";
import type { ReceiptView } from "../report/view/types";
import { STAGE_LABELS } from "./rail";

export type ResultsState = Pick<ReportState, "audience" | "worlds" | "control" | "comparison" | "ledger">;

export interface ProofResult {
  seeds: { id: string; name: string; kind: string; origin: "qloo" | "suggested" | "you" }[];
  /** Top cities by reference-corrected lift: where the taste neighborhood clusters. */
  cities: { label: string; rank: number }[];
  /** "ranked against 22 reference audiences". */
  comparedWith: number | null;
}

export type RealitySource = "site" | "you" | "qloo" | "generic";

export interface RealityResult {
  outcome: string;
  lines: { kind: GapLine["kind"]; text: string; source: RealitySource | null; receipt: ReceiptView | null }[];
}

export const FIELD_LABELS: Readonly<Record<CultureFieldResult["field"], string>> = {
  music: "Music",
  visual: "Visual language",
  wardrobe: "Wardrobe",
  setting: "Setting",
  mood: "Mood",
  voice: "Voice",
  creators: "Creators",
};

export interface FieldResult {
  field: CultureFieldResult["field"];
  label: string;
  signal: CultureFieldResult["signal"];
  /** The strongest origin among the field's cues that has its receipts; null reads "No Qloo signal". */
  origin: CueOrigin | null;
  /** Measured for the whole taste neighborhood, not this world (creators). */
  audienceWide: boolean;
}

export interface WorldResult {
  segmentId: string;
  /** "World 1". */
  position: number;
  label: string;
  ageBand: string | null;
  skew: string | null;
  /** The city this world's settings come from, once its Culture Brief lands. */
  setting: string | null;
  fields: FieldResult[] | null;
  /** The Creative Director's kept concept (origin creative). */
  concept: { title: string; hook: string } | null;
  packReady: boolean;
  /** Where this world stopped early (the stage's name on screen) and why. */
  partial: { stage: string; reason: string } | null;
}

export interface ComparisonResult {
  headline: string | null;
  fits: { world: string; line: string }[];
}

export interface ResultsView {
  proof: ProofResult | null;
  reality: RealityResult | null;
  /** How many worlds Segments measured (null until it has). */
  expectedWorlds: number | null;
  worlds: WorldResult[];
  comparison: ComparisonResult | null;
}

const ORIGIN_RANK: Record<CueOrigin, number> = { qloo: 3, interpreted: 2, yours: 1, creative: 0 };

/**
 * One Culture Brief field as a chip: the strongest origin among its cues, where a Qloo or interpreted
 * cue counts only with its receipts in the ledger. A field with no Qloo signal reads "No Qloo signal"
 * (origin null) unless it carries a creative suggestion or the founder's choice. A field whose Qloo
 * cues lack their receipts is left out: no evidence, no display.
 */
function fieldResult(field: CultureFieldResult, cited: (ids: readonly string[]) => boolean): FieldResult[] {
  const claimsQloo = field.cues.some((cue) => cue.origin === "qloo" || cue.origin === "interpreted");
  const backed = field.cues.filter((cue) => cue.origin === "creative" || cue.origin === "yours" || cited(cue.evidenceIds));
  if (claimsQloo && !backed.some((cue) => cue.origin === "qloo" || cue.origin === "interpreted")) return [];
  const best = backed.reduce<CueOrigin | null>((top, cue) => (top === null || ORIGIN_RANK[cue.origin] > ORIGIN_RANK[top] ? cue.origin : top), null);
  return [{ field: field.field, label: FIELD_LABELS[field.field], signal: field.signal, origin: best, audienceWide: field.scope === "audience" }];
}

/** "Read from your site" is never Qloo; the generic line is the LLM-only brief. */
function sourceOf(line: GapLine): RealitySource | null {
  if (line.kind === "site") return "site";
  if (line.kind === "stated") return "you";
  if (line.kind === "generic") return "generic";
  return line.evidenceIds.length > 0 ? "qloo" : null;
}

export function resultsView(state: ResultsState): ResultsView {
  const ledger = new Map<string, Evidence>(state.ledger.map((entry) => [entry.id, entry]));
  const cited = (ids: readonly string[]) => ids.length > 0 && ids.every((id) => ledger.has(id));
  const { proof, gap, segments } = state.audience;

  const proofResult: ProofResult | null = proof
    ? {
        seeds: proof.seeds.map((seed) => ({ id: seed.ref.id, name: seed.ref.name, kind: plainType(seed.ref.type), origin: seed.origin })),
        cities: proof.cities.filter((city) => cited(city.evidenceIds)).slice(0, 3).map((city) => ({ label: city.label, rank: city.rank })),
        comparedWith: proof.cities[0]?.comparedWith ?? null,
      }
    : null;

  const reality: RealityResult | null = gap
    ? {
        outcome: gap.outcome,
        lines: gap.lines.map((line) => {
          const source = sourceOf(line);
          return { kind: line.kind, text: line.text, source, receipt: source === "qloo" ? receiptView(ledger, line.evidenceIds, "Reality Check", line.text) : null };
        }),
      }
    : null;

  const worldsById = new Map(state.worlds.map((world) => [world.segmentId, world]));
  // Worlds in the order Segments measured them, then any that arrived first (as the reducer's inSegmentOrder does).
  const measured = segments?.items.map((s) => s.id) ?? [];
  const order = [...measured, ...state.worlds.map((w) => w.segmentId).filter((id) => !measured.includes(id))];
  const worlds: WorldResult[] = order.map((segmentId, index) => {
    const world = worldsById.get(segmentId) ?? null;
    const segment = segments?.items.find((s) => s.id === segmentId) ?? null;
    const fields = world?.culture ? world.culture.flatMap((field) => fieldResult(field, cited)) : null;
    const kept = world?.concepts?.best.concept ?? null;
    return {
      segmentId,
      position: index + 1,
      label: world?.label ?? segment?.label ?? segmentId,
      ageBand: segment && cited(segment.evidenceIds) ? segment.ageBand : null,
      skew: segment && cited(segment.evidenceIds) ? skewText(segment.skew) : null,
      setting: world?.settingCity && cited(world.settingCity.evidenceIds) ? world.settingCity.label : null,
      fields,
      concept: kept ? { title: kept.title, hook: kept.hook } : null,
      packReady: Boolean(world?.pack),
      partial: world?.partial ? { stage: STAGE_LABELS[world.partial.stage], reason: world.partial.reason } : null,
    };
  });

  const labels = new Map(worlds.map((w) => [w.segmentId, w.label]));
  const fits = (state.control?.fits ?? []).map((fit) => ({ world: labels.get(fit.segmentId) ?? fit.segmentId, line: fit.line }));
  const comparison = state.comparison || fits.length ? { headline: state.comparison?.headline ?? null, fits } : null;

  return { proof: proofResult, reality, expectedWorlds: segments ? segments.items.length : null, worlds, comparison };
}
