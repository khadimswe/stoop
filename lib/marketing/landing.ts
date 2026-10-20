// View models for the marketing pages (the landing, /judges): narrow, serializable props built on the
// server from the recorded example Reports. Every Qloo fact keeps its receipt from the run's ledger,
// and every sentence the stages wrote is passed through verbatim. The only rewording is the landing's
// third-person voice ("This brand said ...") for lines the gap stage wrote to the founder ("You said ...").
import type { ExampleSlug } from "../demo/examples";
import type { DemoMedia } from "../demo/manifest";
import { AGE_BUCKETS } from "../qloo/constants";
import { rankedBuckets } from "../stages/measure";
import { ageBandLabel } from "../types";
import { formatDate, plainType, skewText } from "../report/view/format";
import { realityView } from "../report/view/reality";
import { ledgerOf, receiptView, type Ledger } from "../report/view/receipts";
import { screeningView } from "../report/view/screening";
import type { ReceiptRow, ReceiptView, ScreeningView } from "../report/view/types";
import type { Report } from "../report/schema";
import type { CultureFieldResult, CultureSource, World } from "../report/world";

// --- Voice ---------------------------------------------------------------------------------------

/** Who a Reality Check line speaks for on the landing. */
export type CardSource = "brand" | "site" | "qloo" | "generic";

const BRAND_VOICE: readonly [RegExp, string][] = [
  [/^You said\b/, "This brand said"],
  [/^Your read is right\b/, "Their read is right"],
  [/\bYour\b/g, "The brand's"],
  [/\byour\b/g, "the brand's"],
  [/\bYou\b/g, "The brand"],
  [/\byou\b/g, "the brand"],
];

/**
 * The gap stage writes to the founder ("You said 25 to 40.", "the band you stated"). The landing
 * talks about an example brand, so the second person moves to the third; nothing else changes.
 */
export function toBrandVoice(text: string): string {
  return BRAND_VOICE.reduce((line, [pattern, replacement]) => line.replace(pattern, replacement), text);
}

/** "This brand said: “Home cooks ..., 25 to 40.”" from the founder's own words, quoted as typed. */
export function brandSaidLine(statedCustomer: string): string {
  return `This brand said: “${statedCustomer.trim()}”`;
}

// --- The Reality Check card (beat 1) -------------------------------------------------------------

export interface CardLineView {
  kind: string;
  text: string;
  source: CardSource | null;
  receipt: ReceiptView | null;
}

export interface RealityCardView {
  slug: string;
  brand: string;
  product: string;
  /** "Oct 16, 2026": when the run was recorded. */
  date: string;
  provenance: Report["meta"]["provenance"];
  outcome: string | null;
  lines: CardLineView[];
  /** One mono line naming the Qloo calls behind the measured line. */
  receiptLine: string | null;
}

/** The Qloo calls behind a line, in one mono line: "/v2/insights · urn:demographics, urn:tag · 3 Qloo calls". */
export function receiptLine(ledger: Ledger, evidenceIds: readonly string[]): string | null {
  const entries = [...new Set(evidenceIds)].flatMap((id) => {
    const entry = ledger.get(id);
    return entry ? [entry] : [];
  });
  if (entries.length === 0) return null;
  const endpoints = [...new Set(entries.map((e) => e.endpoint))].join(", ");
  const types = [...new Set(entries.map((e) => e.params["filter.type"]).filter((t): t is string => typeof t === "string"))];
  const calls = `${entries.length} Qloo ${entries.length === 1 ? "call" : "calls"}`;
  return [endpoints, types.join(", "), calls].filter(Boolean).join(" · ");
}

export function realityCard(slug: ExampleSlug, report: Report, ledger: Ledger = ledgerOf(report)): RealityCardView | null {
  const reality = realityView(report, ledger);
  if (!reality) return null;
  const { product, statedCustomer } = report.inputs;
  const lines: CardLineView[] = [];
  // The founder's own words lead when they exist; the gap's "You said 25 to 40." is the same claim, shorter.
  if (statedCustomer?.trim()) lines.push({ kind: "said", text: brandSaidLine(statedCustomer), source: "brand", receipt: null });
  for (const line of reality.lines) {
    if (line.kind === "stated" && statedCustomer?.trim()) continue;
    const source: CardSource | null = line.source === "you" ? "brand" : line.source;
    lines.push({ kind: line.kind, text: toBrandVoice(line.text), source, receipt: line.receipt });
  }
  const measured = report.audience.gap?.lines.find((l) => l.kind === "measured");
  return {
    slug,
    brand: product.brandName ?? product.name,
    product: product.name,
    date: formatDate(report.meta.createdAt),
    provenance: report.meta.provenance,
    outcome: reality.outcome,
    lines,
    receiptLine: measured ? receiptLine(ledger, measured.evidenceIds) : null,
  };
}

// --- Receipts for a world's brief cues (beat 3) ---------------------------------------------------

const PANEL_NOUN: readonly [RegExp, string][] = [
  [/^urn:entity:artist$/, "reference artists"],
  [/^urn:entity:brand$/, "reference brands"],
  [/^urn:entity:movie$/, "reference films"],
  [/^urn:entity:tv_show$/, "reference TV shows"],
  [/^urn:tag:genre:music/, "reference music tags"],
  [/^urn:tag:emotional_tone/, "reference mood tags"],
];

function panelNoun(type: string): string {
  return PANEL_NOUN.find(([pattern]) => pattern.test(type))?.[1] ?? "reference items";
}

/** "<artist name> (artist) · #4 in its response · beats 24 of 24 reference artists". */
export function sourceLine(source: CultureSource): string {
  const parts = [`${source.name} (${plainType(source.type)})`, `#${source.rank} in its response`];
  if (source.position) parts.push(`beats ${source.position.beats} of ${source.position.of} ${panelNoun(source.type)}`);
  if (source.why.length > 0) parts.push(`why: ${source.why[0]}`);
  return parts.join(" · ");
}

const SIGNAL_TEXT: Record<CultureFieldResult["signal"], string> = {
  rich: "Rich: 3 or more Qloo sources, each beating most of its reference panel",
  thin: "Thin: 1 or 2 Qloo sources",
  none: "No Qloo signal",
};

const ORIGIN_TEXT: Record<string, string> = {
  qloo: "Qloo returned it",
  interpreted: "From Qloo: plain wording of the Qloo results below",
  creative: "Creative suggestion (not from Qloo)",
  yours: "Your choice",
};

const SOURCES_SHOWN = 3;

export type CueField = "music" | "setting" | "wardrobe";

export const CUE_LABEL: Record<CueField, string> = { music: "Music style", setting: "Setting", wardrobe: "Wardrobe" };

/**
 * The receipt for one brief field of one world: the brief's words, its origin and signal, its top
 * Qloo sources with rank and panel position, then each Qloo call. Real names appear only here, never
 * in prompts. Null when the field has no Qloo-backed cue.
 */
export function cueReceipt(world: World, field: CueField, ledger: Ledger): ReceiptView | null {
  const result = world.culture?.find((f) => f.field === field);
  const cue = result?.cues.find((c) => c.origin === "qloo" || c.origin === "interpreted");
  if (!result || !cue) return null;
  const calls = receiptView(ledger, cue.evidenceIds, CUE_LABEL[field], cue.text);
  if (!calls) return null;
  const rows: ReceiptRow[] = [
    { label: "World", value: world.label },
    { label: "Origin", value: ORIGIN_TEXT[cue.origin] ?? cue.origin },
    { label: "Signal", value: SIGNAL_TEXT[result.signal] },
    ...result.sources.slice(0, SOURCES_SHOWN).map((source) => ({ label: "Source", value: sourceLine(source) })),
    ...calls.rows,
  ];
  return {
    cue: CUE_LABEL[field],
    title: cue.text,
    rows,
    calls: calls.calls,
    note: "Source names appear only here, never in prompts. API key never shown.",
  };
}

/**
 * The same receipt, short enough to sit open on the landing: everything up to the first Qloo call,
 * then one line for the calls ("4 calls to /v2/insights, from cache, fetched Oct 16, 2026"). The full
 * receipt stays one tap away.
 */
export function receiptSummary(receipt: ReceiptView, ledger: Ledger, evidenceIds: readonly string[]): ReceiptView {
  const firstCall = receipt.rows.findIndex((r) => r.label === "Endpoint" || r.label === "Call" || r.label.startsWith("Call "));
  const head = firstCall === -1 ? receipt.rows : receipt.rows.slice(0, firstCall);
  const entries = [...new Set(evidenceIds)].flatMap((id) => {
    const entry = ledger.get(id);
    return entry ? [entry] : [];
  });
  const endpoints = [...new Set(entries.map((e) => e.endpoint))].join(" and ");
  const cached = entries.length > 0 && entries.every((e) => e.cached);
  const fetched = entries.map((e) => e.fetchedAt).sort()[0];
  const value = [`${entries.length} ${entries.length === 1 ? "call" : "calls"} to ${endpoints}`, cached ? "from cache" : null, fetched ? `fetched ${formatDate(fetched)}` : null]
    .filter(Boolean)
    .join(", ");
  return { ...receipt, rows: [...head, { label: "Qloo calls", value }] };
}

// --- The landing's Screening Room (beats 2 and 3) -------------------------------------------------

export interface ScreeningCueView {
  field: CueField;
  label: string;
  /** Short enough to sit open next to the screen. */
  summary: ReceiptView;
  /** Every Qloo call behind the cue, for the drawer. */
  receipt: ReceiptView;
}

export interface ScreeningPreviewView {
  brand: string;
  href: string;
  screening: ScreeningView;
  /** Per world, in segment order: the cues that open a receipt (music first). */
  cues: Record<string, ScreeningCueView[]>;
}

const CUE_FIELDS: readonly CueField[] = ["music", "setting", "wardrobe"];

export function screeningPreview(slug: ExampleSlug, report: Report, media: DemoMedia | null, ledger: Ledger = ledgerOf(report)): ScreeningPreviewView {
  const cues: Record<string, ScreeningCueView[]> = {};
  for (const world of report.worlds) {
    cues[world.segmentId] = CUE_FIELDS.flatMap((field) => {
      const receipt = cueReceipt(world, field, ledger);
      const ids = world.culture?.find((f) => f.field === field)?.cues.find((c) => c.origin === "qloo" || c.origin === "interpreted")?.evidenceIds ?? [];
      return receipt ? [{ field, label: CUE_LABEL[field], summary: receiptSummary(receipt, ledger, ids), receipt }] : [];
    });
  }
  return {
    brand: report.inputs.product.brandName ?? report.inputs.product.name,
    href: `/examples/${slug}`,
    screening: screeningView(report, ledger, media),
    cues,
  };
}

// --- The example shelf ----------------------------------------------------------------------------

export interface ShelfItemView {
  slug: string;
  href: string;
  brand: string;
  product: string;
  /** The founder's words, quoted (or the gap's stated line). */
  said: string | null;
  /** The gap stage's measured line, verbatim. */
  measured: string | null;
  /** The Qloo calls behind the measured line, in one mono line. */
  receiptLine: string | null;
  /** A near tie, when there is one: it is never shown as a gap. */
  near: string | null;
  /** The Qloo calls behind the near tie, in one mono line. */
  nearReceiptLine: string | null;
  generic: string | null;
  worlds: { segmentId: string; label: string; settingCity: string | null }[];
  /** The with-vs-without headline, verbatim. */
  headline: string | null;
}

export function shelfItem(slug: ExampleSlug, report: Report, ledger: Ledger = ledgerOf(report)): ShelfItemView {
  const card = realityCard(slug, report, ledger);
  const text = (kind: string) => card?.lines.find((l) => l.kind === kind)?.text ?? null;
  const { product } = report.inputs;
  const near = report.audience.gap?.lines.find((l) => l.kind === "near");
  return {
    slug,
    href: `/examples/${slug}`,
    brand: product.brandName ?? product.name,
    product: product.name,
    said: text("said") ?? text("stated"),
    measured: text("measured"),
    receiptLine: card?.receiptLine ?? null,
    near: text("near"),
    nearReceiptLine: near ? receiptLine(ledger, near.evidenceIds) : null,
    generic: text("generic"),
    worlds: report.worlds.map((w) => ({ segmentId: w.segmentId, label: w.label, settingCity: w.settingCity?.label ?? null })),
    headline: report.comparison?.headline ?? null,
  };
}

// --- "Watch the agent build this": a static replay of the recorded trace ---------------------------

export interface ReplayLineView {
  kind: "tool" | "decision";
  label: string;
  reason: string | null;
}

export interface ReplayStepView {
  id: string;
  title: string;
  /** Qloo calls in this step: the trace's tool steps, each one ledger entry. */
  calls: number;
  lines: ReplayLineView[];
}

export interface ReplayView {
  brand: string;
  date: string;
  steps: ReplayStepView[];
  /** Every tool step in the trace: one Qloo call each, all served from the recording. */
  calls: number;
  cached: number;
}

const LINES_PER_STEP = 3;

/** The trace, folded into the five steps of "How it works", in pipeline order, with real counts. */
export function replayView(report: Report): ReplayView {
  const worlds = report.worlds.length;
  const groups = [
    { id: "prove", title: "Mapped the taste neighborhood", stages: ["prove"] },
    { id: "gap", title: "Reality Check", stages: ["gap"] },
    { id: "segments", title: `${worlds} concept ${worlds === 1 ? "world" : "worlds"}`, stages: ["segments"] },
    { id: "culture", title: "Culture briefs", stages: ["culture", "score"] },
    { id: "pack", title: "Production Pack", stages: ["concepts", "prompts"] },
  ];
  const steps = groups.map((group) => {
    const trace = report.trace.filter((t) => group.stages.includes(t.stage));
    // Decisions say what the agent chose and why, so they lead; tool steps fill the rest, in trace order.
    const decisions = trace.filter((t) => t.kind === "decision").slice(0, 2);
    const tools = trace.filter((t) => t.kind === "tool").slice(0, LINES_PER_STEP - decisions.length);
    const kept = new Set([...decisions, ...tools]);
    return {
      id: group.id,
      title: group.title,
      calls: trace.filter((t) => t.kind === "tool").length,
      // The landing speaks about the example brand, so the trace reads in the same third person.
      lines: trace.filter((t) => kept.has(t)).map((t) => ({ kind: t.kind, label: toBrandVoice(t.label), reason: t.reason ? toBrandVoice(t.reason) : null })),
    };
  });
  const tools = report.trace.filter((t) => t.kind === "tool");
  return {
    brand: report.inputs.product.brandName ?? report.inputs.product.name,
    date: formatDate(report.meta.createdAt),
    steps: steps.filter((s) => s.lines.length > 0),
    calls: tools.length,
    cached: tools.filter((t) => t.cached).length,
  };
}

// --- The receipts teaser --------------------------------------------------------------------------

export interface TeaserView {
  brand: string;
  href: string;
  worldLabel: string;
  /** The with-vs-without headline and the world's scoreboard line, verbatim. */
  headline: string | null;
  fitLine: string | null;
  /** One cliche the check flagged: the generic brief's assumption and what Qloo measured, as written. */
  cliche: { assumed: string; measured: string; receipt: ReceiptView } | null;
}

const CLICHE_ORDER = ["cities", "music", "mood", "reference", "age"];

export function teaserView(slug: ExampleSlug, report: Report, ledger: Ledger = ledgerOf(report)): TeaserView | null {
  const world = report.worlds[0];
  if (!world) return null;
  const fit = report.control?.fits.find((f) => f.segmentId === world.segmentId) ?? null;
  const cliches = [...(world.check?.cliches ?? [])].sort((a, b) => rank(a.dimension) - rank(b.dimension));
  let cliche: TeaserView["cliche"] = null;
  for (const c of cliches) {
    const receipt = receiptView(ledger, c.evidenceIds, "Cliche check", c.measured);
    if (receipt) {
      cliche = { assumed: c.assumed, measured: c.measured, receipt };
      break;
    }
  }
  return {
    brand: report.inputs.product.brandName ?? report.inputs.product.name,
    href: `/examples/${slug}`,
    worldLabel: world.label,
    headline: report.comparison?.headline ?? null,
    fitLine: fit?.line ?? null,
    cliche,
  };
}

function rank(dimension: string): number {
  const i = CLICHE_ORDER.indexOf(dimension);
  return i === -1 ? CLICHE_ORDER.length : i;
}

// --- The scoreboard across examples (/judges) -------------------------------------------------------

export interface ScoreboardRowView {
  slug: string;
  href: string;
  brand: string;
  headline: string | null;
  /** Per world, the check's own lines, with the Qloo calls behind them. */
  worlds: { label: string; control: string; qloo: string; cliches: number; receipt: ReceiptView | null }[];
}

export function scoreboardRow(slug: ExampleSlug, report: Report, ledger: Ledger = ledgerOf(report)): ScoreboardRowView {
  const labels = new Map(report.worlds.map((w) => [w.segmentId, w.label]));
  return {
    slug,
    href: `/examples/${slug}`,
    brand: report.inputs.product.brandName ?? report.inputs.product.name,
    headline: report.comparison?.headline ?? null,
    worlds: (report.comparison?.worlds ?? []).map((w) => {
      const label = labels.get(w.segmentId) ?? w.segmentId;
      return { label, control: w.control, qloo: w.qloo, cliches: w.cliches, receipt: receiptView(ledger, w.evidenceIds, "With vs without", `${label}: ${w.control}`) };
    }),
  };
}

// --- The agent demo slot's still (until the recorded-run player lands) -----------------------------

export interface AgentDemoStillView {
  brand: string;
  /** "Oct 16, 2026": when the run was recorded. */
  date: string;
  /** The gap stage's measured line, verbatim. */
  measured: string | null;
  /** The Qloo calls behind the measured line, in one mono line: its receipt. */
  receiptLine: string | null;
  /** The pipeline's steps as the replay folds them, each with its real Qloo call count. */
  steps: { id: string; title: string; calls: number }[];
  /** Every Qloo call in the trace, and how many came from the recording. */
  calls: number;
  cached: number;
}

/** The lead run in one frame: its steps, its Reality Check line and its Qloo call count, all from the recording. */
export function agentDemoStill(slug: ExampleSlug, report: Report, ledger: Ledger = ledgerOf(report)): AgentDemoStillView {
  const replay = replayView(report);
  const card = realityCard(slug, report, ledger);
  return {
    brand: replay.brand,
    date: replay.date,
    measured: card?.lines.find((l) => l.kind === "measured")?.text ?? null,
    receiptLine: card?.receiptLine ?? null,
    steps: replay.steps.map(({ id, title, calls }) => ({ id, title, calls })),
    calls: replay.calls,
    cached: replay.cached,
  };
}

// --- The "Qloo measures the audience" step card's mini chart ---------------------------------------

export interface AgeSkewBarView {
  label: string;
  /** "skews +0.21": a relative index from -1 to 1, never a share. */
  text: string;
  /** -100 to 100: the skew on the bar's half scale. */
  value: number;
  top: boolean;
}

export interface AgeSkewMiniView {
  brand: string;
  bars: AgeSkewBarView[];
  /** The chart in words, for screen readers. */
  summary: string;
  /** The Qloo call behind the chart, in one mono line: its receipt. */
  receiptLine: string | null;
}

/** An example's age skews from Qloo's demographics, youngest bucket first, the top skew marked. Null without a receipt. */
export function ageSkewMini(report: Report, ledger: Ledger = ledgerOf(report)): AgeSkewMiniView | null {
  const demographics = report.audience.proof?.demographics;
  const receipt = demographics ? receiptLine(ledger, demographics.evidenceIds) : null;
  if (!demographics || !receipt) return null;
  const { age } = demographics;
  const top = rankedBuckets(age)[0];
  const brand = report.inputs.product.brandName ?? report.inputs.product.name;
  const bars = AGE_BUCKETS.map((bucket) => ({
    label: ageBandLabel(bucket),
    text: skewText(age[bucket]),
    value: Math.round(Math.max(-1, Math.min(1, age[bucket])) * 100),
    top: bucket === top,
  }));
  return { brand, bars, summary: `${brand}'s age skews from Qloo: highest for ${ageBandLabel(top)} (${skewText(age[top])}).`, receiptLine: receipt };
}
