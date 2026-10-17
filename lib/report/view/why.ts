// Why it works: the seeds Qloo measured from (with their origins), the audience's top stable cities
// by lift, the with-vs-without headline, and Prove's caveats. Every Qloo fact carries its receipt.
import type { Report } from "../schema";
import { plainType } from "./format";
import { receiptView, type Ledger } from "./receipts";
import type { ReceiptView } from "./types";

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

export interface WhyView {
  seeds: SeedView[];
  /**
   * The audience's top cities by lift, stable ones only: a city flagged as swinging between the
   * reference sets is left out, as the Reality Check leaves it out (lib/stages/gap.ts).
   */
  cities: CityView[];
  comparisonHeadline: string | null;
  /** Honest caveats from Prove: "thin-heatmap", "few-seeds". */
  flags: string[];
}

const TOP_CITIES = 3;

export function whyView(report: Report, ledger: Ledger): WhyView {
  const proof = report.audience.proof;
  const seeds = proof?.seeds ?? report.inputs.seeds;
  return {
    seeds: seeds.map((seed) => {
      const kind = plainType(seed.ref.type);
      const receipt = receiptView(ledger, seed.evidenceIds, "Seed", `${seed.ref.name} (${kind})`);
      if (receipt && seed.match === "affix") receipt.rows.unshift({ label: "Matched", value: "Qloo lists it under a longer name" });
      return { name: seed.ref.name, kind, origin: seed.origin, match: seed.match ?? null, receipt };
    }),
    cities: (proof?.cities ?? [])
      .filter((city) => city.flags.length === 0)
      .slice(0, TOP_CITIES)
      .map((city) => ({
        label: city.label,
        rank: city.rank,
        comparedWith: city.comparedWith,
        receipt: receiptView(ledger, city.evidenceIds, "City", `${city.label}, #${city.rank} by lift, ranked against ${city.comparedWith} reference audiences`),
      })),
    comparisonHeadline: report.comparison?.headline ?? null,
    flags: proof?.flags ?? [],
  };
}
