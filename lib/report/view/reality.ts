// The Reality Check (demo beat 1): the gap stage's lines, verbatim and in order, each with who it
// speaks for and its receipt. A near tie stays a near tie; nothing here forces a gap.
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
}

export interface RealityView {
  outcome: RealityCheck["outcome"];
  lines: RealityLineView[];
  dimensions: RealityDimensionView[];
}

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

export function realityView(report: Report, ledger: Ledger): RealityView | null {
  const gap = report.audience.gap;
  if (!gap) return null;
  return {
    outcome: gap.outcome,
    lines: gap.lines.map((line) => {
      const source = sourceOf(line);
      return { kind: line.kind, text: line.text, source, receipt: source === "qloo" ? receiptView(ledger, line.evidenceIds, "Reality Check", line.text) : null };
    }),
    dimensions: gap.dimensions.map(({ dimension, outcome }) => ({ dimension, outcome })),
  };
}
