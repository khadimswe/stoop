// Per-visitor limits in fixed windows, on the shared store (keys.rate). A visitor is a salted hash
// of their IP (lib/store/visitor.ts), so a limit never stores a raw IP. Fixed windows are coarse
// (a burst at a window's edge can reach twice the limit), which is fine for limits that only stop
// floods: the daily caps and the per-run budgets are the real cost guards.
import { keys } from "./store/keys";
import type { Store } from "./store/types";
import type { TokenVisitorId, VisitorId } from "./store/visitor";

/** Who a limit counts: a visitor by their IP, or an MCP caller by its token (lib/store/visitor.ts). */
export type RateSubject = VisitorId | TokenVisitorId;

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
  /**
   * Requests to /api/mcp without a valid token (initialize, tools/list, refusals), per IP. High enough
   * that a hosted connector's shared server IP is not starved; tool calls themselves need a token.
   */
  mcp: { name: "mcp", limit: 600, windowSeconds: 10 * 60 },
  /** Requests to /api/mcp with a valid token, per token (never per IP). */
  mcpCaller: { name: "mcp-caller", limit: 120, windowSeconds: 10 * 60 },
  /** score_brief spends Qloo calls (up to SCORE_BRIEF_CAP each). Per token. */
  scoreBrief: { name: "mcp-score-brief", limit: 10, windowSeconds: HOUR },
  /** culture_brief reads a page and runs intake before StartRun's own limits apply. Per token. */
  cultureBrief: { name: "mcp-culture-brief", limit: 3, windowSeconds: HOUR },
  /** Requests to POST /api/mcp/token (honeypot hits and refusals included); issuing itself is capped per day (mcpCaps().issue). */
  mcpTokenIssue: { name: "mcp-token-requests", limit: 10, windowSeconds: HOUR },
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
export async function hitRate(store: Store, rule: RateRule, visitor: RateSubject, now: number = Date.now(), by = 1): Promise<RateResult> {
  const { window, retryAfterSeconds } = windowOf(rule, now);
  // The counter outlives its window a little, then disappears.
  const count = await store.incr(keys.rate(rule.name, visitor, window), { by, ttlSeconds: rule.windowSeconds + 60 });
  return { ok: count <= rule.limit, count, retryAfterSeconds };
}

/** What a rule's current window has counted so far, without counting anything. */
export async function rateUsed(store: Store, rule: RateRule, visitor: RateSubject, now: number = Date.now()): Promise<number> {
  return (await store.get<number>(keys.rate(rule.name, visitor, windowOf(rule, now).window))) ?? 0;
}

/** The counter a rule's current window counts in, for reserving against it (reserveUpTo). */
export function ruleCounter(rule: RateRule, visitor: RateSubject, now: number = Date.now()): { key: string; ttlSeconds: number } {
  return { key: keys.rate(rule.name, visitor, windowOf(rule, now).window), ttlSeconds: rule.windowSeconds + 60 };
}

// --- Reservations ---------------------------------------------------------------------------------
//
// Spend is taken before it happens: a counter is raised first (atomic), and what does not fit under its
// cap is given back at once, so concurrent requests can never pass the cap together. Units the work did
// not use, or that a failure left unspent, are given back afterwards.

/**
 * Takes up to `want` units of a counter capped at `cap` and gives back what does not fit. Returns how
 * many it got. `ttlSeconds` applies when this call creates the counter.
 */
export async function reserveUpTo(store: Store, key: string, want: number, cap: number, ttlSeconds: number): Promise<number> {
  if (want <= 0) return 0;
  const after = await store.incr(key, { by: want, ttlSeconds });
  const granted = Math.max(0, Math.min(want, cap - (after - want)));
  if (granted < want) await store.incr(key, { by: granted - want });
  return granted;
}

/** Gives back units taken with reserveUpTo. The TTL only applies if the counter has expired since, so no key outlives its window. */
export async function giveBack(store: Store, key: string, count: number, ttlSeconds?: number): Promise<void> {
  if (count > 0) await store.incr(key, { by: -count, ...(ttlSeconds ? { ttlSeconds } : {}) });
}

/** One capped counter a unit of work takes from, named for the refusal message. */
export interface Capped<N extends string = string> {
  name: N;
  key: string;
  cap: number;
  ttlSeconds: number;
}

/** Units taken from several counters. Releasing gives them all back, once, however often it is called. */
export interface Reservation {
  release(): Promise<void>;
}

export type Reserved<N extends string> = { ok: true; reservation: Reservation } | { ok: false; full: N };

/**
 * Takes one unit from each counter, in order. When one is full, the units already taken are given back
 * and `full` names that counter. Put the narrowest counter first, so a request refused by its own limit
 * never holds a shared one, even for a moment.
 */
export async function reserveEach<N extends string>(store: Store, counters: readonly Capped<N>[]): Promise<Reserved<N>> {
  const taken: Capped<N>[] = [];
  const release = async (list: readonly Capped<N>[]) => {
    await Promise.all(list.map((c) => giveBack(store, c.key, 1, c.ttlSeconds)));
  };
  for (const counter of counters) {
    let granted = 0;
    try {
      granted = await reserveUpTo(store, counter.key, 1, counter.cap, counter.ttlSeconds);
    } catch (error) {
      await release(taken).catch(() => undefined);
      throw error;
    }
    if (granted === 0) {
      await release(taken);
      return { ok: false, full: counter.name };
    }
    taken.push(counter);
  }
  let released = false;
  return {
    ok: true,
    reservation: {
      async release() {
        if (released) return;
        released = true;
        await release(taken);
      },
    },
  };
}

/** A reservation that holds nothing, for work no limit applies to. */
export const NOTHING_RESERVED: Reservation = { release: async () => undefined };

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
