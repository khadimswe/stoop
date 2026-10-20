// How long a draft video is, shared by the server (lib/config.ts renderLimits, RENDER_DRAFT_SECONDS)
// and the report's video line, which says the length GET /api/render/access answers with, or this
// default when an answer leaves it out. A plain module, safe in the browser.

/** Seconds per draft unless RENDER_DRAFT_SECONDS says otherwise. */
export const DEFAULT_DRAFT_SECONDS = 15;
/** What RENDER_DRAFT_SECONDS may be: fal bills per second, and the pack's ad is 15 s. */
export const DRAFT_SECONDS_RANGE = { min: 4, max: 15 } as const;
