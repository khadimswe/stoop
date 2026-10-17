// Receipts from the report's ledger: the Qloo calls behind a fact or cue, with the exact query (the
// API key travels in a header and is never in it). No evidence, no receipt.
import type { Evidence } from "../../evidence";
import type { Report } from "../schema";
import { formatDate } from "./format";
import type { ReceiptRow, ReceiptView } from "./types";

export type Ledger = ReadonlyMap<string, Evidence>;

export function ledgerOf(report: Pick<Report, "ledger">): Ledger {
  return new Map(report.ledger.map((entry) => [entry.id, entry]));
}

function callRows(entry: Evidence): ReceiptRow[] {
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
    if (entries.length === 1) return entry.label ? [{ label: "Call", value: entry.label }, ...rows] : rows;
    return [{ label: `Call ${i + 1} of ${entries.length}`, value: entry.label ?? entry.endpoint }, ...rows];
  });
  return { cue, title, rows, calls: entries.length };
}
