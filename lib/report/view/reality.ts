// The Reality Check (demo beat 1): the gap stage's lines, verbatim and in order, each with who it
// speaks for and its receipt, then one row per dimension with its own outcome and margin. A near tie
// stays a near tie and a confirmed read stays confirmed; nothing here forces a gap.
import type { DimensionCheck, GapLine, RealityCheck, Report } from "../schema";
import { receiptView, type Ledger } from "./receipts";
import type { ReceiptView } from "./types";

/** Who a line speaks for: "Read from your site", "You", "Qloo", or the LLM-only generic brief. */
export type RealitySource = "site" | "you" | "qloo" | "generic";

export interface RealityLineView {
  kind: GapLine["kind"];
  /** Written by the gap stage; render verbatim. */
  text: string;
  source: RealitySource | null;
  receipt: ReceiptView | null;
}

export interface RealityDimensionView {
  dimension: DimensionCheck["dimension"];
  outcome: DimensionCheck["outcome"];
  /** "Age", "Gender", "Cities", "Taste". */
  label: string;
  /** What was stated, in Qloo's dimensions, and who stated it; null when nothing was. */
  stated: string | null;
  statedBy: DimensionCheck["statedBy"];
  /** What Qloo measured, as the gap stage wrote it ("top skew 55 and older (0.21)"). */
  measured: string;
  /** "gap", "near tie", "confirmed", "no measurable affinity", "not stated". */
  outcomeLabel: string;
  /** The margin the outcome rests on, in words; null when there is none to show. */
  margin: string | null;
  /** The stated age band spans more than 25 years, so a match says little. */
  broad: boolean;
  receipt: ReceiptView | null;
}

export interface RealityView {
  outcome: RealityCheck["outcome"];
  lines: RealityLineView[];
  dimensions: RealityDimensionView[];
}

const LABEL: Record<DimensionCheck["dimension"], string> = { age: "Age", gender: "Gender", cities: "Cities", taste: "Taste" };

/** Never "gap" for a near tie, never "unsupported" for a missing score. */
const OUTCOME_LABEL: Record<DimensionCheck["outcome"], string> = {
  gap: "gap",
  near_tie: "near tie",
  confirmed: "confirmed",
  unverifiable: "no measurable affinity",
  not_stated: "not stated",
};

/** "Read from your site" is never Qloo; the generic line is the LLM-only brief. */
function sourceOf(line: GapLine): RealitySource | null {
  switch (line.kind) {
    case "site":
      return "site";
    case "stated":
      return "you";
    case "generic":
      return "generic";
    default:
      return line.evidenceIds.length > 0 ? "qloo" : null;
  }
}

/**
 * The margin in words, per dimension: age is a difference between skew indices, gender a skew
 * strength, cities a rank by lift, taste a stated tag's place against the reference tag panel.
 * Only for a stated dimension (an unstated one has no margin).
 */
export function marginText(d: Pick<DimensionCheck, "dimension" | "margin" | "position" | "outcome">): string | null {
  if (d.outcome === "not_stated") return null;
  if (d.dimension === "taste") return d.position ? `${d.position.tag} beats ${d.position.beats} of ${d.position.of} reference tags` : null;
  if (d.margin === null) return null;
  switch (d.dimension) {
    case "age":
      return `${d.margin.toFixed(2)} apart on the skew index`;
    case "gender":
      return `skews ${d.margin.toFixed(2)}`;
    case "cities":
      return `#${Math.round(d.margin)} by lift`;
  }
}

export function realityView(report: Report, ledger: Ledger): RealityView | null {
  const gap = report.audience.gap;
  if (!gap) return null;
  return {
    outcome: gap.outcome,
    lines: gap.lines.map((line) => {
      const source = sourceOf(line);
      return { kind: line.kind, text: line.text, source, receipt: source === "qloo" ? receiptView(ledger, line.evidenceIds, "Reality Check", line.text) : null };
    }),
    dimensions: gap.dimensions.map((d) => ({
      dimension: d.dimension,
      outcome: d.outcome,
      label: LABEL[d.dimension],
      stated: d.stated,
      statedBy: d.statedBy,
      measured: d.measured,
      outcomeLabel: OUTCOME_LABEL[d.outcome],
      margin: marginText(d),
      broad: d.broad,
      receipt: receiptView(ledger, d.evidenceIds, `Reality Check: ${LABEL[d.dimension].toLowerCase()}`, `Qloo measured: ${d.measured}`),
    })),
  };
}
