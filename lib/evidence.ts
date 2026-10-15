import type { Endpoint } from "./qloo/constants";

/**
 * The receipt behind every audience fact and creative cue. No evidence, no display.
 * Params are the exact query sent to Qloo. The API key travels in a header and never appears here.
 */
export interface Evidence {
  id: string;
  endpoint: Endpoint;
  params: Record<string, string>;
  /** Human label for the trace, e.g. "Resolving Olipop to a brand entity". */
  label?: string;
  /** Pipeline stage that made the call, e.g. "prove". */
  stage?: string;
  status: number;
  /** True when no Qloo call was spent for this result (cache hit, or shared with an identical call in flight). */
  cached: boolean;
  /** True when this result came from an identical request already in flight. */
  shared?: boolean;
  /** When Qloo served the response (ISO). For cached entries this is the original fetch time. */
  fetchedAt: string;
  durationMs: number;
  /** Filled by later stages when a specific item is cited. */
  rank?: { position: number; of: number };
  panelPosition?: { beats: number; of: number };
  explain?: string;
}

export interface Ledger {
  readonly entries: Evidence[];
  add(entry: Omit<Evidence, "id">): Evidence;
}

export function createLedger(runId: string): Ledger {
  const entries: Evidence[] = [];
  return {
    entries,
    add(entry) {
      const evidence: Evidence = { id: `${runId}:${entries.length + 1}`, ...entry };
      entries.push(evidence);
      return evidence;
    },
  };
}
