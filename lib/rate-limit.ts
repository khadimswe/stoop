// Per-visitor limits in fixed windows, on the shared store (keys.rate). A visitor is a salted hash
// of their IP (lib/store/visitor.ts), so a limit never stores a raw IP. Fixed windows are coarse
// (a burst at a window's edge can reach twice the limit), which is fine for limits that only stop
// floods: the daily caps and the per-run budgets are the real cost guards.
import { keys } from "./store/keys";
import type { Store } from "./store/types";
import type { VisitorId } from "./store/visitor";

export interface RateRule {
  /** The key's name segment: one counter per rule, visitor and window. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowSeconds: number;
}

const HOUR = 60 * 60;

/** Every per-visitor limit in lane C's routes. */
export const RATE_RULES = {
  /** Signups and the success screen's product link (the same entry, posted twice). */
  waitlist: { name: "waitlist", limit: 8, windowSeconds: HOUR },
  /** The founder's CSV export, so a wrong token cannot be tried at speed. */
  waitlistExport: { name: "waitlist-export", limit: 10, windowSeconds: HOUR },
  vote: { name: "vote", limit: 30, windowSeconds: HOUR },
  voteRead: { name: "vote-read", limit: 600, windowSeconds: HOUR },
  /** Every JSON-RPC request to /api/mcp (listing tools included). */
  mcp: { name: "mcp", limit: 120, windowSeconds: 10 * 60 },
  /** score_brief spends Qloo calls (up to SCORE_BRIEF_CAP each). */
  scoreBrief: { name: "mcp-score-brief", limit: 10, windowSeconds: HOUR },
  /** culture_brief reads a page and runs intake before StartRun's own limits apply. */
  cultureBrief: { name: "mcp-culture-brief", limit: 3, windowSeconds: HOUR },
} as const satisfies Record<string, RateRule>;

export interface RateResult {
  ok: boolean;
  /** Requests counted in this window, this one included. */
  count: number;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
}

function windowOf(rule: RateRule, now: number) {
  const windowMs = rule.windowSeconds * 1000;
  const window = Math.floor(now / windowMs);
  return { window: String(window), retryAfterSeconds: Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)) };
}

/** Counts `by` (default one request) against a rule and says whether the window is still within its limit. */
export async function hitRate(store: Store, rule: RateRule, visitor: VisitorId, now: number = Date.now(), by = 1): Promise<RateResult> {
  const { window, retryAfterSeconds } = windowOf(rule, now);
  // The counter outlives its window a little, then disappears.
  const count = await store.incr(keys.rate(rule.name, visitor, window), { by, ttlSeconds: rule.windowSeconds + 60 });
  return { ok: count <= rule.limit, count, retryAfterSeconds };
}

/** What a rule's current window has counted so far, without counting anything. */
export async function rateUsed(store: Store, rule: RateRule, visitor: VisitorId, now: number = Date.now()): Promise<number> {
  return (await store.get<number>(keys.rate(rule.name, visitor, windowOf(rule, now).window))) ?? 0;
}

// --- Global daily budgets -------------------------------------------------------------------------

const DAY = 24 * HOUR;

/**
 * Everyone at once: a global budget is a per-visitor limit with one shared visitor, on the same keys
 * (keys.rate), so it needs no new key family. Its windows are UTC days, like the daily caps.
 */
export const EVERYONE = "v_000000000000000000000000" as VisitorId;

export const DAILY_RULES = {
  /**
   * Fresh Qloo calls all score_brief calls may spend per UTC day, a slice of QLOO_DAILY_CAP (500), so
   * agents can never starve live runs. Each call's own context is capped to what is left.
   */
  scoreBriefQloo: { name: "daily-mcp-score-qloo", limit: 120, windowSeconds: DAY },
  /** Waitlist confirmations per UTC day (Resend's free tier sends 100 a day), so signups made with other people's addresses cannot burn the sender's quota. */
  confirmationEmails: { name: "daily-waitlist-emails", limit: 100, windowSeconds: DAY },
} as const satisfies Record<string, RateRule>;
