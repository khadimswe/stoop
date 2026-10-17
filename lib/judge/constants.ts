// The judge pass's names and cookie options, with no crypto, so pages and client scripts can import
// them (the banner reads the hint cookie). Signing and verifying live in ./pass (server only).

export const JUDGE_PARAM = "judge";
/** The credential: httpOnly, read only by the render routes. */
export const JUDGE_COOKIE = "stoop_judge";
/** A hint for the page ("1"): readable by scripts so the static report can show the banner. Never a credential. */
export const JUDGE_HINT_COOKIE = "stoop_judge_ui";
/**
 * At least 16 characters, and random (for example `openssl rand -base64 18`): the code's randomness is the
 * real defense against guessing, since the proxy answers a wrong code without waiting on the store.
 */
export const JUDGE_CODE_MIN = 16;
/** Wrong judge codes per IP per hour, counted best effort (keys.rate("judge-code", ...)) when the store answers quickly. */
export const JUDGE_CODE_ATTEMPTS_PER_HOUR = 10;

/**
 * Cookie options for the pass and its hint. SameSite=Lax and the browser-only Origin check on POST
 * /api/render (lib/routes/guard.ts browserOnly) together keep a cookie-authenticated paid action safe
 * from cross-site requests; never loosen these to SameSite=None. Secure is set on https.
 */
export const JUDGE_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/" } as const;
export const JUDGE_HINT_COOKIE_OPTIONS = { httpOnly: false, sameSite: "lax", path: "/" } as const;
