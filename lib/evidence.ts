import { z } from "zod";
import { sha256 } from "./hash";
import { ENDPOINTS, type Endpoint } from "./qloo/constants";
import { canonicalQuery } from "./qloo/params";

/**
 * The receipt behind every audience fact and creative cue. No evidence, no display.
 * Params are the exact query sent to Qloo. The API key travels in a header and never appears here.
 */
export interface Evidence {
  /** Content-addressed: the same request always has the same id, in any run, replay or resumed stage. */
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

export const evidenceSchema = z.strictObject({
  id: z.string().regex(/^ev_[0-9a-f]{12}$/),
  endpoint: z.enum(Object.values(ENDPOINTS) as [Endpoint, ...Endpoint[]]),
  params: z.record(z.string(), z.string()),
  label: z.string().optional(),
  stage: z.string().optional(),
  status: z.number().int(),
  cached: z.boolean(),
  shared: z.boolean().optional(),
  fetchedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  rank: z.strictObject({ position: z.number().int(), of: z.number().int() }).optional(),
  panelPosition: z.strictObject({ beats: z.number().int(), of: z.number().int() }).optional(),
  explain: z.string().optional(),
}) satisfies z.ZodType<Evidence>;

/** `ev_` plus the first 12 hex characters of sha256 of the request as sent ("<endpoint>?<canonical query>"). */
export function evidenceId(endpoint: string, params: Record<string, string>): string {
  return `ev_${sha256(`${endpoint}?${canonicalQuery(params)}`).slice(0, 12)}`;
}

export interface Ledger {
  readonly entries: Evidence[];
  /**
   * Records a receipt. The same request recorded twice in one run keeps one ledger entry (the
   * first); the returned receipt still describes this call (for example cached: true).
   */
  add(entry: Omit<Evidence, "id">): Evidence;
}

/** One ledger per run. Ids are content-addressed, so they don't depend on the run. */
export function createLedger(): Ledger {
  const entries: Evidence[] = [];
  const byId = new Map<string, Evidence>();
  return {
    entries,
    add(entry) {
      const id = evidenceId(entry.endpoint, entry.params);
      const evidence: Evidence = { id, ...entry };
      if (!byId.has(id)) {
        entries.push(evidence);
        byId.set(id, evidence);
      }
      return evidence;
    },
  };
}
