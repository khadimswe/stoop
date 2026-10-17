// Every store key and TTL in one place, so the runtime, frames, revise, the waitlist and votes share
// one layout. Visitors and emails appear only as salted hashes (lib/store/visitor.ts): the keys take
// branded types, so a raw IP or email cannot be passed by mistake.
import type { SaltedHash, VisitorId } from "./visitor";

export const DAY_SECONDS = 24 * 60 * 60;

export const TTL = {
  /** A live run's event lists and meta. */
  runEvents: 7 * DAY_SECONDS,
  /** A finished live report. */
  report: 30 * DAY_SECONDS,
  /** An intake (product, reading, proposed and searched seeds) waiting for /start's confirmation. */
  intake: DAY_SECONDS,
  /** Qloo responses (CLAUDE.md section 2). */
  qlooCache: 7 * DAY_SECONDS,
  /** Daily counters outlive their day a little, so a counter never resets mid-day by clock skew. */
  daily: DAY_SECONDS + 60 * 60,
} as const;

/** The UTC day a daily counter belongs to: "2026-10-17". */
export const dayOf = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Names of the global daily caps (CLAUDE.md section 6), plus per-visitor limits. */
export type DailyCap = "live-runs" | "frames" | "qloo" | "renders";

export const keys = {
  run: {
    meta: (runId: string) => `run:${runId}:meta`,
    /** One list per attempt: a resumed run streams again from seq 0 under the next attempt. */
    events: (runId: string, attempt: number) => `run:${runId}:${attempt}:events`,
    /** The seq counter per attempt: every writer takes its seqs from it. */
    seq: (runId: string, attempt: number) => `run:${runId}:${attempt}:seq`,
    report: (runId: string) => `run:${runId}:report`,
    /** Recorded Claude steps for a run (memoized stages): a resume replays them for free. */
    llm: (runId: string, stepHash: string) => `run:${runId}:llm:${stepHash}`,
    /**
     * Held while one world's frames render in one attempt, so repeated requests cannot spend the daily
     * frame cap twice. Per attempt: a resumed run renders its frames again (cached renders and memoized
     * critiques make that free) without waiting on the stopped attempt's lock.
     */
    framesLock: (runId: string, attempt: number, segmentId: string) => `run:${runId}:${attempt}:frames:${segmentId}:lock`,
    /** Revisions started for a run, against its revise limit. */
    revisions: (runId: string) => `run:${runId}:revisions`,
  },
  /** Idempotent starts: the brief hash points at the run already started for it. */
  brief: (briefHash: string) => `brief:${briefHash}`,
  intake: (intakeId: string) => `intake:${intakeId}`,
  /** The random salt for visitor hashes (lib/store/visitor.ts). */
  visitorSalt: "visitor:salt",
  /** Live-run admission leases (at most 2 at once). */
  liveLeases: "leases:live-runs",
  qloo: {
    cache: (requestHash: string) => `qloo:cache:${requestHash}`,
    /** The global pacer's next free start slot (Store.reserveSlot, 250 ms apart). */
    pacer: "qloo:pacer",
    /** The last x-month-ratelimit-remaining seen. */
    monthRemaining: "qloo:month-remaining",
  },
  daily: (cap: DailyCap, day: string = dayOf()) => `daily:${cap}:${day}`,
  /** Per-visitor limits in a time window: `window` is e.g. the hour or day the count belongs to. */
  rate: (name: string, visitor: VisitorId, window: string) => `rate:${name}:${visitor}:${window}`,
  waitlist: {
    position: "waitlist:position",
    /** Keyed by the salted hash of the normalized email, so a repeat signup keeps its position. */
    entry: (email: SaltedHash) => `waitlist:entry:${email}`,
    entries: "waitlist:entries",
  },
  votes: {
    count: (example: string, choice: string) => `votes:${example}:${choice}`,
    visitor: (example: string, visitor: VisitorId) => `votes:${example}:by:${visitor}`,
  },
} as const;
