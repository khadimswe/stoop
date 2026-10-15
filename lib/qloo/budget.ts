// Qloo call budget. The hackathon key allows about 10,000 calls a month, and the demo must stay
// live through judging (Nov 2 to Nov 16), so every live run has a hard cap and a per-stage plan.

/** Hard cap for one live run. Only live (uncached) calls count. */
export const RUN_CAP = 50;
/** Cap for one "not this vibe" revision. */
export const REVISE_CAP = 6;
/** Cap for offline example generation, which may use 3 segments instead of 2. */
export const OFFLINE_CAP = 80;

/**
 * Planned live calls per stage for a 2-segment run. Seeds are resolved by autocomplete before the
 * run starts, so Prove spends nothing on search.
 */
export const RUN_BUDGET = {
  prove: 3, // urn:tag, urn:demographics, urn:heatmap
  gap: 2, // /v2/tags for the stated customer, /v2/analysis/compare
  segments: 2, // one urn:tag re-run per segment for the distinctness check
  culture: 12, // artist, movie, tv_show, brand, place per segment (10), person + podcast once (2)
  resolve: 8, // /search for the LLM-only brief's named references
  scoring: 8, // one filter.results.entities call per type per segment
  critique: 4, // self-critique re-queries and thin-field probes
  searchReserve: 4, // retries of ambiguous resolutions
} as const;
export type BudgetStage = keyof typeof RUN_BUDGET;

export const PLANNED_CALLS = Object.values(RUN_BUDGET).reduce((sum, calls) => sum + calls, 0);
