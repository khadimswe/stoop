// How long a live run's parts are kept, said one way everywhere in the UI. The numbers come from the
// store's TTLs (lib/store/keys.ts): a finished report for 30 days, the run's events (which storyboards
// and "Not this vibe" need) for 7. Plain strings, safe in the browser.
import { DAY_SECONDS, TTL } from "../../store/keys";

export const REPORT_DAYS = TTL.report / DAY_SECONDS;
export const LIVE_ACTION_DAYS = TTL.runEvents / DAY_SECONDS;

/** The one retention statement. */
export const RETENTION_LINE = `Live reports are kept for ${REPORT_DAYS} days. Storyboards and "Not this vibe" work for the first ${LIVE_ACTION_DAYS}.`;

/** Shown in their place once a run's events have expired (the report answers with no events URL). */
export const ACTIONS_EXPIRED_LINE = `Storyboards and "Not this vibe" are closed for this run: they work for the first ${LIVE_ACTION_DAYS} days. The report stays readable for ${REPORT_DAYS} days.`;
