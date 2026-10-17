// Storyboard world jobs per visitor per day, on top of the global FRAMES_DAILY_CAP (lib/config.ts
// STORYBOARD_LIMITS): a world job renders up to 8 frames with its re-renders, and a visitor may start 6
// a day per signed visitor cookie and 15 a day per IP (a salted hash), blocked when either is over. The
// cookie counts a browser next to its IP, never instead of it: clearing cookies makes a new cookie id,
// but the IP count stays. Without STOOP_SIGNING_SECRET there is no cookie id, and the IP counts alone.
// A run started over MCP counts against its token instead of the IP (the same 15 a day), because hosted
// connectors call from servers many users share.
//
// A job counts against the visitor it renders for (FramesJob.visitor): the one who started the run, kept
// in the run meta, when the runtime renders a world as its pack lands; the one who asks, in POST
// /api/frames/<id>, which covers a revision's frames too. It is taken lazily, inside the world's lock,
// at the first pass that needs a fresh render, so a job served from the frame cache (a resumed run, a
// repeat request) needs no room in the day and counts nothing. It is kept once a fresh frame rendered
// (or was billed), and given back when none did or the job failed.
import { STORYBOARD_LIMITS } from "../config";
import { reserveEach, type Capped, type Reservation } from "../rate-limit";
import { dayOf, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import type { CookieVisitorId, TokenVisitorId, VisitorId } from "../store/visitor";
import type { FramesOutcome } from "./frames";

/** The world.frames reason when the day's frames are spent, globally or for this visitor: one message for both. */
export const PAUSED_REASON = "Storyboards paused today.";

/** Who a storyboard job counts against. */
export interface StoryboardVisitor {
  /** The salted IP id (15 a day), or for a run started over MCP the token's id (the same 15 a day, per token). */
  id: VisitorId | TokenVisitorId;
  /** The signed visitor cookie's id, or null (no secret configured, or a client with no cookie, like an MCP agent). */
  cookie: CookieVisitorId | null;
}

export interface StoryboardLimits {
  perCookieDaily: number;
  perIpDaily: number;
}

/** The counter of one visitor's storyboard jobs on one UTC day. */
export const storyboardCounter = (visitor: VisitorId | CookieVisitorId | TokenVisitorId, day: string = dayOf()) => keys.rate("storyboards", visitor, day);

function counters(visitor: StoryboardVisitor, day: string, limits: StoryboardLimits): Capped<"cookie" | "id">[] {
  return [
    ...(visitor.cookie ? [{ name: "cookie" as const, key: storyboardCounter(visitor.cookie, day), cap: limits.perCookieDaily, ttlSeconds: TTL.daily }] : []),
    { name: "id", key: storyboardCounter(visitor.id, day), cap: limits.perIpDaily, ttlSeconds: TTL.daily },
  ];
}

/**
 * Takes one world job from the visitor's day: the cookie's count first (the narrower one), then the IP's.
 * Null when either is spent, with nothing taken.
 */
export async function reserveStoryboard(store: Store, visitor: StoryboardVisitor, now: number = Date.now(), limits: StoryboardLimits = STORYBOARD_LIMITS): Promise<Reservation | null> {
  const reserved = await reserveEach(store, counters(visitor, dayOf(now), limits));
  return reserved.ok ? reserved.reservation : null;
}

/** Whether the visitor's day is already spent, by either count. Only a read: the job itself reserves. */
export async function storyboardsSpent(store: Store, visitor: StoryboardVisitor, now: number = Date.now(), limits: StoryboardLimits = STORYBOARD_LIMITS): Promise<boolean> {
  const used = await Promise.all(counters(visitor, dayOf(now), limits).map(async (c) => ((await store.get<number>(c.key)) ?? 0) >= c.cap));
  return used.some(Boolean);
}

/** Whether a finished job used a storyboard: it rendered (or was billed for) at least one fresh frame. */
export function jobSpent(outcome: FramesOutcome): boolean {
  return outcome.cost.frames > 0;
}

/** One job's place in its visitor's day: taken at most once, when the job first needs a fresh render. */
export interface StoryboardHold {
  /** True when the job may render fresh frames: no visitor to count, or a place taken (now or earlier). */
  take(): Promise<boolean>;
  /** Keeps the place when the job rendered a fresh frame; gives it back when it did not, or failed (null). */
  settle(outcome: FramesOutcome | null): Promise<void>;
}

export function storyboardHold(store: Store, visitor: StoryboardVisitor | null | undefined, now: () => number, limits: StoryboardLimits = STORYBOARD_LIMITS): StoryboardHold {
  let held: Reservation | null = null;
  return {
    async take() {
      if (!visitor || held) return true;
      held = await reserveStoryboard(store, visitor, now(), limits);
      return held !== null;
    },
    async settle(outcome) {
      if (held && (outcome === null || !jobSpent(outcome))) await held.release();
    },
  };
}
