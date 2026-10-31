// "Who loves these spots": the adult age bands the people who love a community's places skew toward,
// as the Community step shows it. Plain data and pure functions with no server imports, so the client
// card can check the route's answer before it shows anything. Qloo's values are relative skew
// indices from -1 to 1, never shares of anyone: the copy says "skew", never "% of".
import type { ReceiptView } from "../../report/view/types";

/** Stoop's adult bands in Qloo's order. Qloo's youngest bucket includes minors, so it always reads "18 to 24". */
export const AGE_BANDS = [
  { bucket: "24_and_younger", label: "18 to 24", low: 18, high: 24 },
  { bucket: "25_to_29", label: "25 to 29", low: 25, high: 29 },
  { bucket: "30_to_34", label: "30 to 34", low: 30, high: 34 },
  { bucket: "35_to_44", label: "35 to 44", low: 35, high: 44 },
  { bucket: "45_to_54", label: "45 to 54", low: 45, high: 54 },
  { bucket: "55_and_older", label: "55 and older", low: 55, high: null },
] as const;
export type AgeBandBucket = (typeof AGE_BANDS)[number]["bucket"];

export interface AgeBandView {
  bucket: AgeBandBucket;
  label: string;
  /** Mean skew across the spots, -1 to 1, rounded to 2 decimals. */
  skew: number;
}

export interface AgesView {
  /** "25 to 34": the one or two bands with the highest positive skew, joined when they touch. */
  top: string;
  /** Every adult band Qloo answered for, in age order. */
  bands: AgeBandView[];
  /** How many of the community's places were the signal. */
  spots: number;
  receipt: ReceiptView;
}

/** "25 to 34" for two bands that touch, "18 to 24 and 45 to 54" for two that do not, one band's own label. */
export function topLabel(buckets: readonly AgeBandBucket[]): string {
  const bands = AGE_BANDS.filter((b) => buckets.includes(b.bucket));
  if (bands.length === 0) return "";
  if (bands.length === 1) return bands[0]!.label;
  const [a, b] = [bands[0]!, bands[1]!];
  const touching = AGE_BANDS.indexOf(b) - AGE_BANDS.indexOf(a) === 1;
  if (!touching) return `${a.label} and ${b.label}`;
  return b.high === null ? `${a.low} and older` : `${a.low} to ${b.high}`;
}

/** The card's one line. Never the store's buyers: the people who love the places nearby. */
export function agesLine(top: string, from: "the store" | "the event" = "the store"): string {
  return `People who love the spots near ${from === "the event" ? "the event" : "your store"} skew ${top}`;
}

/** "+0.21", "-0.05", "0.00": a skew as Stoop prints it, never as a percent. */
export function skewText(skew: number): string {
  if (Math.abs(skew) < 0.005) return "0.00";
  return `${skew > 0 ? "+" : ""}${skew.toFixed(2)}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The route's answer, checked field by field; null for anything else (an empty body, an error, a
 * shape from another version), so the card renders nothing rather than something wrong.
 */
export function agesViewOf(body: unknown): AgesView | null {
  if (!isRecord(body) || typeof body.top !== "string" || !body.top || typeof body.spots !== "number" || !Array.isArray(body.bands)) return null;
  const known = new Map<string, (typeof AGE_BANDS)[number]>(AGE_BANDS.map((b) => [b.bucket, b]));
  const bands: AgeBandView[] = [];
  for (const b of body.bands) {
    if (!isRecord(b) || typeof b.bucket !== "string" || typeof b.skew !== "number" || !Number.isFinite(b.skew) || b.skew < -1 || b.skew > 1) return null;
    const band = known.get(b.bucket);
    if (!band) return null;
    // The label is always Stoop's own, so the youngest band can never read as anything but 18 to 24.
    bands.push({ bucket: band.bucket, label: band.label, skew: b.skew });
  }
  if (bands.length === 0) return null;
  const r = body.receipt;
  if (!isRecord(r) || typeof r.cue !== "string" || typeof r.title !== "string" || typeof r.calls !== "number" || !Array.isArray(r.rows)) return null;
  const rows = r.rows.filter((row): row is { label: string; value: string; mono?: boolean } => isRecord(row) && typeof row.label === "string" && typeof row.value === "string");
  if (rows.length === 0) return null;
  return { top: body.top, bands, spots: body.spots, receipt: { cue: r.cue, title: r.title, calls: r.calls, rows: rows.map((row) => ({ label: row.label, value: row.value, ...(row.mono ? { mono: true } : {}) })) } };
}
