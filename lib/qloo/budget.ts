// Qloo call budget. The hackathon key allows about 10,000 calls a month, and the demo must stay
// live through judging (Nov 2 to Nov 16), so every live run has a hard cap and a per-stage plan.

/** Hard cap for one live run. Every live HTTP attempt counts, retries included; cached and shared results do not. */
export const RUN_CAP = 50;
/** Cap for one "not this vibe" revision. */
export const REVISE_CAP = 6;
/** Cap for offline example generation, which may use 3 segments instead of 2. */
export const OFFLINE_CAP = 80;
/** Live runs stop calling Qloo when fewer than this many calls are left this month (examples always work). */
export const MONTHLY_FLOOR = 300;

/**
 * Planned live calls per budget row for a 2-segment run, recalibrated from Gates 2 and 3. Seeds are
 * resolved at intake (its own budget) before the run starts, so Prove spends nothing on search. A
 * live run passes this table as its context's rowCaps, so a request tagged with a row is refused
 * once that row is spent (the culture agent's probes can never eat the scoring calls).
 */
export const RUN_BUDGET = {
  prove: 4, // urn:demographics, urn:heatmap, music-genre tags, emotional-tone tags
  gap: 2, // stated taste tags scored against the tag panel (one call per kind named)
  segments: 6, // per segment: artist and brand (shared with Culture) and a heatmap
  culture: 8, // per world: movie, TV and places (6); person and podcast once for the audience (2)
  localities: 2, // /search for each world's setting city as a Qloo locality (cached across runs)
  scoring: 12, // per world: one filter.results call per scored type (artist, brand, movie, TV, music, tone)
  probes: 4, // the culture agent's own tools (tag search, one-genre probes, panel scoring), shared by the worlds
  resolve: 4, // /search for the LLM-only brief's named references
  searchReserve: 2, // retries of ambiguous resolutions
} as const;
export type BudgetRow = keyof typeof RUN_BUDGET;

export const PLANNED_CALLS = Object.values(RUN_BUDGET).reduce((sum, calls) => sum + calls, 0);

/**
 * Planned live calls for one intake: the /start read of a link before the founder confirms seeds.
 * Intake is its own request with its own RunContext capped at INTAKE_CAP, before any run exists, so
 * it never spends from a run's RUN_CAP; the daily caps (QLOO_DAILY_CAP) still bound it.
 */
export const INTAKE_BUDGET = {
  readingTags: 2, // /v2/tags for the site reading's taste tags
  statedTags: 2, // /v2/tags for the stated customer's taste tags (the same reading, run on the founder's words)
  categoryTags: 2, // /v2/tags for the Qloo category seeds
  suggestionSearches: 8, // /search for Claude's suggested seeds
} as const;
export type IntakeBudgetRow = keyof typeof INTAKE_BUDGET;

/** Hard cap for one intake. */
export const INTAKE_CAP = 14;

/**
 * Planned live calls for one MCP `score_brief` (Qloo only, no LLM). Its own context with these rows
 * as rowCaps, so a request can never spend more, whatever it asks. The rows reuse the run table's
 * names because every Qloo request names a BudgetRow. The tool's input caps (5 seeds, 8 choices that
 * need a lookup) keep a request inside the plan; cached calls are free.
 */
export const SCORE_BRIEF_BUDGET = {
  resolve: 13, // /search for each seed (up to 5) and each named choice, /v2/tags for each music style (up to 8 together)
  prove: 6, // Qloo's own top list for this audience, per scored type the choices touch (artist, brand, film, TV, music, mood)
  scoring: 6, // one filter.results call per scored type: Qloo's picks, the choices and the frozen panel together
} as const satisfies Partial<Record<BudgetRow, number>>;

/** Hard cap for one score_brief: the planned rows plus two retries. */
export const SCORE_BRIEF_CAP = Object.values(SCORE_BRIEF_BUDGET).reduce((sum, calls) => sum + calls, 0) + 2;
