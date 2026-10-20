// Why a world's storyboard frames are paused, in the words the report shows. A plain module (no
// server imports), so the live report's view models, built in the browser, can tell the two apart.

/** The day's frames are spent, globally or for this visitor: one message for both. */
export const PAUSED_REASON = "Storyboards paused today.";
/** No frame service or storage is configured on this server: it is not a daily limit. */
export const NO_SERVICE_REASON = "Storyboards are not set up on this server.";
