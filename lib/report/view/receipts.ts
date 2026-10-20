// Receipts from the report's ledger: the Qloo calls behind a fact or cue, with the exact query (the
// API key travels in a header and is never in it). No evidence, no receipt.
import type { Evidence } from "../../evidence";
import type { Report } from "../schema";
import type { CultureSource, PanelPosition } from "../world";
import { formatDate, plainType } from "./format";
import type { ReceiptRow, ReceiptView } from "./types";

export type Ledger = ReadonlyMap<string, Evidence>;

export function ledgerOf(report: Pick<Report, "ledger">): Ledger {
  return new Map(report.ledger.map((entry) => [entry.id, entry]));
}

// One set of rows per ledger entry, shared by every receipt that cites it: the page sends each call's
// rows once, however many cues it backs.
const rowsByEntry = new WeakMap<Evidence, ReceiptRow[]>();

function callRows(entry: Evidence): ReceiptRow[] {
  const cached = rowsByEntry.get(entry);
  if (cached) return cached;
  const rows = buildCallRows(entry);
  rowsByEntry.set(entry, rows);
  return rows;
}

function buildCallRows(entry: Evidence): ReceiptRow[] {
  const rows: ReceiptRow[] = [{ label: "Endpoint", value: entry.endpoint, mono: true }];
  const type = entry.params["filter.type"];
  if (type) rows.push({ label: "Asked for", value: type, mono: true });
  const query = Object.entries(entry.params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  if (query) rows.push({ label: "Query", value: query, mono: true });
  // fetchedAt is when Qloo served it, also for cache hits and recorded runs.
  rows.push({ label: "Served", value: `${entry.cached ? "From cache, fetched" : "Fetched from Qloo"} ${formatDate(entry.fetchedAt)}` });
  if (entry.status !== 200) rows.push({ label: "Status", value: `HTTP ${entry.status}`, mono: true });
  return rows;
}

/**
 * The receipt for one fact: each cited ledger entry in order, introduced by what the call did when
 * there is more than one. Null when none of the ids is in the ledger.
 */
export function receiptView(ledger: Ledger, evidenceIds: readonly string[], cue: string, title: string): ReceiptView | null {
  const entries = [...new Set(evidenceIds)].map((id) => ledger.get(id)).filter((entry): entry is Evidence => Boolean(entry));
  if (entries.length === 0) return null;
  const rows = entries.flatMap((entry, i) => {
    const rows = callRows(entry);
    // A fresh array each time: callers may add rows of their own (the cached rows stay shared).
    if (entries.length === 1) return entry.label ? [{ label: "Call", value: entry.label }, ...rows] : [...rows];
    return [{ label: `Call ${i + 1} of ${entries.length}`, value: entry.label ?? entry.endpoint }, ...rows];
  });
  return { cue, title, rows, calls: entries.length };
}

// --- Panel positions --------------------------------------------------------------------------------

/** What a reference panel is made of, by Qloo type: "artists", "TV shows", "music tags". */
const PANEL_NOUNS: Readonly<Record<string, string>> = {
  "urn:entity:artist": "artists",
  "urn:entity:brand": "brands",
  "urn:entity:movie": "films",
  "urn:entity:tv_show": "TV shows",
  "urn:entity:podcast": "podcasts",
  "urn:entity:person": "people",
  "urn:entity:place": "places",
  "urn:entity:book": "books",
  "urn:entity:videogame": "video games",
  "urn:tag:genre:music": "music tags",
  "urn:tag:emotional_tone:qloo": "mood tags",
};

/** The panel's items in plain words, for any Qloo type: "artists", "music tags", or "tags". */
export function panelNoun(type: string): string {
  const known = PANEL_NOUNS[type];
  if (known) return known;
  if (type.startsWith("urn:tag")) return "tags";
  const plain = plainType(type);
  return plain.endsWith("s") ? plain : `${plain}s`;
}

/**
 * "beats 23 of 25 reference artists": a rank inside one scoring call, never a percentile. Under 5
 * panel items there is no median (aboveMedian is null), and the line says so instead of claiming one.
 */
export function panelText(position: PanelPosition, noun: string): string {
  const base = `beats ${position.beats} of ${position.of} reference ${noun}`;
  return position.aboveMedian === null ? `${base} (too few for a median)` : base;
}

/** "#4 in its response": a pick's place in its own Qloo answer, only ever compared inside that answer. */
export const rankText = (rank: number) => `#${rank} in its response`;

/**
 * The Qloo picks behind a cue, as receipt rows: each with its type, its place in its own response,
 * where it lands against the frozen panel (or "no panel" for places, people and podcasts), and
 * Qloo's own "why" for places. Real names live here, in receipts, never in prompts.
 */
export function sourceRows(sources: readonly CultureSource[]): ReceiptRow[] {
  return sources.flatMap((source, i) => {
    const facts = [plainType(source.type), rankText(source.rank), source.position ? panelText(source.position, panelNoun(source.type)) : "no reference panel for this type"];
    const rows: ReceiptRow[] = [{ label: sources.length === 1 ? "Qloo pick" : `Qloo pick ${i + 1}`, value: `${source.name} (${facts.join(", ")})` }];
    if (source.why.length > 0) rows.push({ label: "Why", value: source.why.join("; ") });
    return rows;
  });
}

/** A receipt with the Qloo picks first, then the calls they came from. Null without a ledger entry. */
export function receiptWithSources(ledger: Ledger, evidenceIds: readonly string[], sources: readonly CultureSource[], cue: string, title: string): ReceiptView | null {
  const receipt = receiptView(ledger, evidenceIds, cue, title);
  if (!receipt) return null;
  return { ...receipt, rows: [...sourceRows(sources), ...receipt.rows] };
}
