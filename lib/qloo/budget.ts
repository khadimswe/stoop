// Qloo call budget. The hackathon key allows about 10,000 calls a month, and the demo must stay
// live through judging (Nov 2 to Nov 16), so every live run has a hard cap and a per-stage plan.

/** Hard cap for one live run. Every live HTTP attempt counts, retries included; cached and shared results do not. */
export const RUN_CAP = 50;
/** Cap for one "not this vibe" revision. */
export const REVISE_CAP = 6;
/** Cap for offline example generation, which may use 3 segments instead of 2. */
export const OFFLINE_CAP = 80;

/**
 * Planned live calls per stage for a 2-segment run, recalibrated from Gate 2's recordings. Seeds are
 * resolved by autocomplete before the run starts, so Prove spends nothing on search. Gate 4
 * re-checks the culture and scoring rows.
 */
export const RUN_BUDGET = {
  prove: 4, // urn:demographics, urn:heatmap, music-genre tags, emotional-tone tags
  gap: 2, // stated taste tags scored against the tag panel (one call per kind named)
  segments: 6, // per segment: artist and brand (shared with Culture) and a heatmap
  culture: 8, // per segment: movie, TV and places (6); person and podcast once (2)
  resolve: 4, // /search for the LLM-only brief's named references (rarely beyond the seeds, Gate 2)
  scoring: 12, // per segment: one filter.results call per scored type (artist, brand, movie, TV, music, tone)
  critique: 4, // self-critique re-queries and thin-field probes
  searchReserve: 6, // suggested-seed resolution and retries of ambiguous resolutions
} as const;
export type BudgetStage = keyof typeof RUN_BUDGET;

export const PLANNED_CALLS = Object.values(RUN_BUDGET).reduce((sum, calls) => sum + calls, 0);
