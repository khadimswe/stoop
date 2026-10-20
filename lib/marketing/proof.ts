// The landing's proof band: a few big numbers taken from the recorded example runs, each with the
// Qloo calls behind it. Nothing here is typed in by hand: every figure is read from a Report (the
// gap stage's age check, the Control's scored choices), and a pick whose data no longer says what it
// claims is dropped instead of shown. The tests pin each number to the recorded report.
import type { ExampleSlug } from "../demo/examples";
import { AGE_BUCKETS, type AgeBucket } from "../qloo/constants";
import { rankedBuckets } from "../stages/measure";
import { ageBandLabel } from "../types";
import { receiptView, type Ledger } from "../report/view/receipts";
import type { ReceiptRow, ReceiptView } from "../report/view/types";
import { STATUS_LABELS } from "../report/view/why";
import type { Report } from "../report/schema";
import type { ControlChoice } from "../report/world";
import { figureText, num, text, type FigurePart } from "./count-up";

/** Which fact a stat shows: the Reality Check's age gap, or a generic AI brief's city or music, scored by Qloo. */
export type ProofKind = "age" | "city" | "music";

export interface ProofPick {
  slug: ExampleSlug;
  kind: ProofKind;
}

/**
 * The band, in order. Picked Oct 19 from the recorded runs as the strongest facts the data supports
 * exactly: two founders' stated ages against their measured taste neighborhoods (both full gaps,
 * never a near tie), the generic brief's worst city, and its music where it misses a world.
 */
export const PROOF_PICKS: readonly ProofPick[] = [
  { slug: "food-hot-sauce", kind: "age" },
  { slug: "pets-outfits", kind: "city" },
  { slug: "food-hot-sauce", kind: "music" },
  { slug: "home-candles", kind: "age" },
];

/** Who made the claim a stat answers: the founder, their site (as read), or the LLM-only generic brief. Never Qloo. */
export type ClaimSource = "brand" | "site" | "generic";

export interface ProofStatView {
  id: string;
  brand: string;
  /** What was claimed before Qloo measured it: "Said 25 to 40", "Picked Los Angeles". */
  claim: { text: string; source: ClaimSource };
  /** The big figure. Numbers count up; the final figure is `figureText`. */
  figure: FigurePart[];
  figureText: string;
  /** One bold line under the figure: what the number is. */
  unit: string;
  /** One plain line of context: the world it was measured for, or where the age comes from. */
  detail: string;
  /** The Qloo calls behind every number the stat shows. A stat without one is never shown. */
  receipt: ReceiptView;
}

const brandOf = (report: Report) => report.inputs.product.brandName ?? report.inputs.product.name;

/**
 * An age bucket as a figure that stays put: Qloo measures age bands, not ages, so the count never
 * runs through a number it did not measure (only ranks count up). "55 and older" is 55+, the youngest
 * bucket is "18 to 24" (adults only).
 */
export function ageFigure(bucket: AgeBucket): FigurePart[] {
  if (bucket === "24_and_younger") return [text("18"), text(" to ", "sm"), text("24")];
  const older = /^(\d+)_and_older$/.exec(bucket);
  if (older) return [text(older[1]), text("+")];
  const band = /^(\d+)_to_(\d+)$/.exec(bucket);
  if (!band) throw new Error(`Unknown age bucket ${bucket}`);
  return [text(band[1]), text(" to ", "sm"), text(band[2])];
}

/** The Reality Check's age line as a stat, only when it is a full gap: a near tie or a confirmed read is never a stat. */
export function ageStat(slug: ExampleSlug, report: Report, ledger: Ledger): ProofStatView | null {
  const age = report.audience.gap?.dimensions.find((d) => d.dimension === "age");
  const proof = report.audience.proof;
  if (!age || age.outcome !== "gap" || !age.stated || !proof) return null;
  const top = rankedBuckets(proof.demographics.age)[0];
  // The gap stage names the same bucket; if it ever disagrees, the stat is dropped rather than guessed.
  if (!top || !AGE_BUCKETS.includes(top) || !age.measured.startsWith(`top skew ${ageBandLabel(top)} `)) return null;
  const brand = brandOf(report);
  const site = age.statedBy === "site";
  const claim = site ? `Their site speaks to ${age.stated}` : `Said ${age.stated}`;
  const calls = receiptView(ledger, age.evidenceIds, "Reality Check: age", `${claim}. Qloo measured a taste neighborhood that skews ${ageBandLabel(top)}.`);
  if (!calls) return null;
  const head: ReceiptRow[] = [
    { label: site ? "Read from their site" : "Brand said", value: age.stated },
    { label: "Qloo measured", value: age.measured },
    { label: "Outcome", value: "Gap: Qloo's top age skew is outside the stated band" },
  ];
  const figure = ageFigure(top);
  return {
    id: `${slug}-age`,
    brand,
    claim: { text: claim, source: site ? "site" : "brand" },
    figure,
    figureText: figureText(figure),
    unit: `Qloo measured: skews ${ageBandLabel(top)}`,
    detail: "The top age skew of the product's taste neighborhood, from Qloo's demographics.",
    receipt: { ...calls, rows: [...head, ...calls.rows] },
  };
}

interface ScoredChoice {
  choice: ControlChoice;
  segmentId: string;
}

/** The Control's choices of one kind across worlds, each with the world it was scored for. */
function choicesOf(report: Report, dimension: ControlChoice["dimension"]): ScoredChoice[] {
  return (report.control?.fits ?? []).flatMap((fit) => fit.choices.filter((c) => c.dimension === dimension).map((choice) => ({ choice, segmentId: fit.segmentId })));
}

const worldLabel = (report: Report, segmentId: string) => report.worlds.find((w) => w.segmentId === segmentId)?.label ?? segmentId;

/** Every Qloo call behind a stat: the world it shows, and each other world it names. */
const evidenceOf = (worst: ScoredChoice, others: readonly ScoredChoice[]) => [...worst.choice.evidenceIds, ...others.flatMap((o) => o.choice.evidenceIds)];

/** "Upbeat funk-soul groove with a tight drum break": a long brief line, cut at its first comma. */
export function firstClause(value: string): string {
  return value.split(/[,.;]/)[0]?.trim() || value;
}

/** The generic brief's city that ranks lowest (by its place in the world's city list) for one world. */
export function cityStat(slug: ExampleSlug, report: Report, ledger: Ledger): ProofStatView | null {
  const ranked = choicesOf(report, "cities").filter((s) => s.choice.rank && s.choice.measured);
  const below = ranked.filter((s) => s.choice.status === "below");
  const worst = [...below].sort((a, b) => b.choice.rank!.rank / b.choice.rank!.of - a.choice.rank!.rank / a.choice.rank!.of)[0];
  if (!worst) return null;
  const { choice, segmentId } = worst;
  const rank = choice.rank!;
  // The same city in the brand's other worlds, whatever the check found there: the whole picture, not one world.
  const others = ranked.filter((s) => s !== worst && s.choice.text === choice.text);
  const calls = receiptView(ledger, evidenceOf(worst, others), "Generic choice: city", choice.measured!);
  if (!calls) return null;
  const head: ReceiptRow[] = [
    { label: "Generic AI brief", value: `Picked ${choice.text} (not from Qloo)` },
    { label: "World", value: worldLabel(report, segmentId) },
    { label: "Qloo measured", value: choice.measured! },
    { label: "Check", value: STATUS_LABELS[choice.status] },
    ...others.map((o) => ({ label: "Other world", value: `${worldLabel(report, o.segmentId)}: ${o.choice.measured} (${STATUS_LABELS[o.choice.status]})` })),
  ];
  // The rank counts up from #1; the size of the list stays put.
  const figure = [text("#"), num(rank.rank, { from: 1 }), text(` of ${rank.of}`, "sm")];
  return {
    id: `${slug}-city`,
    brand: brandOf(report),
    claim: { text: `Picked ${choice.text}`, source: "generic" },
    figure,
    figureText: figureText(figure),
    // The brief's own word for the city; the receipt names the metro Qloo ranked ("Los Angeles, CA").
    unit: `Where Qloo ranks ${choice.text} among this world's cities`,
    detail: [`World: ${worldLabel(report, segmentId)}.`, ...others.map((o) => `For ${worldLabel(report, o.segmentId)}: #${o.choice.rank!.rank} of ${o.choice.rank!.of}.`)].join(" "),
    receipt: { ...calls, rows: [...head, ...calls.rows] },
  };
}

/** The generic brief's music where it lands lowest against a world's reference panel (only below the median). */
export function musicStat(slug: ExampleSlug, report: Report, ledger: Ledger): ProofStatView | null {
  const placed = choicesOf(report, "music").filter((s) => s.choice.position);
  const below = placed.filter((s) => s.choice.status === "below" && s.choice.position!.aboveMedian === false);
  const worst = [...below].sort((a, b) => a.choice.position!.beats / a.choice.position!.of - b.choice.position!.beats / b.choice.position!.of)[0];
  if (!worst) return null;
  const { choice, segmentId } = worst;
  const position = choice.position!;
  const tag = report.control?.mappings.find((m) => m.dimension === "music" && m.text === choice.text)?.ref?.name ?? null;
  // The same music scored for the brand's other worlds, whatever it found: one brief, different fits.
  const others = placed.filter((s) => s !== worst && s.choice.text === choice.text);
  const calls = receiptView(ledger, evidenceOf(worst, others), "Generic choice: music", choice.measured ?? choice.text);
  if (!calls || !tag) return null;
  const head: ReceiptRow[] = [
    { label: "Generic AI brief", value: `${choice.text} (not from Qloo)` },
    { label: "Scored as", value: `${tag} (a Qloo music tag)` },
    { label: "World", value: worldLabel(report, segmentId) },
    { label: "Qloo measured", value: `beats ${position.beats} of ${position.of} reference music tags for this world` },
    { label: "Check", value: STATUS_LABELS[choice.status] },
    ...others.map((o) => ({ label: "Other world", value: `${worldLabel(report, o.segmentId)}: beats ${o.choice.position!.beats} of ${o.choice.position!.of} (${STATUS_LABELS[o.choice.status]})` })),
  ];
  // The panel position counts up from 0; the panel's size stays put.
  const figure = [num(position.beats), text(` of ${position.of}`, "sm")];
  return {
    id: `${slug}-music`,
    brand: brandOf(report),
    claim: { text: `Picked ${firstClause(choice.text).toLowerCase()}`, source: "generic" },
    figure,
    figureText: figureText(figure),
    unit: `Reference music tags it beats, scored as “${tag}”`,
    detail: [
      `World: ${worldLabel(report, segmentId)}.`,
      ...others.map((o) => `For ${worldLabel(report, o.segmentId)} it beats ${o.choice.position!.beats} of ${o.choice.position!.of}.`),
    ].join(" "),
    receipt: { ...calls, rows: [...head, ...calls.rows] },
  };
}

const BUILDERS: Record<ProofKind, (slug: ExampleSlug, report: Report, ledger: Ledger) => ProofStatView | null> = {
  age: ageStat,
  city: cityStat,
  music: musicStat,
};

/** The band's stats, in pick order. A pick the data no longer supports is left out, never padded. */
export function proofStats(picks: readonly ProofPick[], load: (slug: ExampleSlug) => { report: Report; ledger: Ledger }): ProofStatView[] {
  return picks.flatMap((pick) => {
    const { report, ledger } = load(pick.slug);
    const stat = BUILDERS[pick.kind](pick.slug, report, ledger);
    return stat ? [stat] : [];
  });
}
