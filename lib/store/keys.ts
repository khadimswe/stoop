// Every store key and TTL in one place, so the runtime, frames, revise, the waitlist and votes share
// one layout. Visitors and emails appear only as salted hashes (lib/store/visitor.ts): the keys take
// branded types, so a raw IP or email cannot be passed by mistake.
import type { CookieVisitorId, SaltedHash, VisitorId } from "./visitor";

export const DAY_SECONDS = 24 * 60 * 60;

export const TTL = {
  /** A live run's event lists and meta. */
  runEvents: 7 * DAY_SECONDS,
  /** A finished live report. */
  report: 30 * DAY_SECONDS,
  /** An intake (product, reading, proposed and searched seeds) waiting for /start's confirmation. */
  intake: DAY_SECONDS,
  /** A rendered storyboard frame's URL, by prompt hash. */
  frameRender: 30 * DAY_SECONDS,
  /** Qloo responses (CLAUDE.md section 2). */
  qlooCache: 7 * DAY_SECONDS,
  /** Daily counters outlive their day a little, so a counter never resets mid-day by clock skew. */
  daily: DAY_SECONDS + 60 * 60,
  /** A draft video job, and a finished render by its input hash. */
  renderJob: 7 * DAY_SECONDS,
  renderCache: 30 * DAY_SECONDS,
  /** Counters that span the whole judging period (lifetime render total, per-pass renders). */
  judging: 60 * DAY_SECONDS,
  /** An MCP token record outlives its expiry a little, so a late call is refused as expired, not unknown. */
  mcpToken: 45 * DAY_SECONDS,
} as const;

/** The UTC day a daily counter belongs to: "2026-10-17". */
export const dayOf = (now: number = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Names of the global daily caps (CLAUDE.md section 6), plus per-visitor limits. */
export type DailyCap = "live-runs" | "frames" | "qloo" | "renders" | "intakes" | "mcp-calls" | "mcp-tokens";

export const keys = {
  run: {
    meta: (runId: string) => `run:${runId}:meta`,
    /** One list per attempt: a resumed run streams again from seq 0 under the next attempt. */
    events: (runId: string, attempt: number) => `run:${runId}:${attempt}:events`,
    /** The seq counter per attempt: every writer takes its seqs from it. */
    seq: (runId: string, attempt: number) => `run:${runId}:${attempt}:seq`,
    report: (runId: string) => `run:${runId}:report`,
    /** Claimed by the one start or resume that runs this attempt, so two clicks never run it twice. */
    attempt: (runId: string, attempt: number) => `run:${runId}:${attempt}:claim`,
    /** What the run was started with (inputs, readings, receipts, settings), so a resume rebuilds it. */
    input: (runId: string) => `run:${runId}:input`,
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
  /** Seeds the founder added through Qloo search for an intake, and how many searches it made. */
  intakeSearched: (intakeId: string) => `intake:${intakeId}:searched`,
  intakeSearches: (intakeId: string) => `intake:${intakeId}:searches`,
  /** The random salt for visitor hashes (lib/store/visitor.ts). */
  visitorSalt: "visitor:salt",
  /** Live-run admission leases (at most 2 at once). */
  liveLeases: "leases:live-runs",
  qloo: {
    cache: (requestHash: string) => `qloo:cache:${requestHash}`,
    /** The global pacer's next free start slot (Store.reserveSlot, 250 ms apart). */
    pacer: "qloo:pacer",
    /** The last x-month-ratelimit-remaining seen this month (a new month starts without it). */
    monthRemaining: (month: string = new Date().toISOString().slice(0, 7)) => `qloo:month-remaining:${month}`,
  },
  daily: (cap: DailyCap, day: string = dayOf()) => `daily:${cap}:${day}`,
  frames: {
    /** A rendered frame by its prompt hash (the stored URL): a repeat render, as after a resume, is free and not counted against the cap. */
    render: (promptHash: string) => `frames:render:${promptHash}`,
  },
  render: {
    /** A server-paid draft job (lib/render/schema.ts). BYOK renders never reach the server. */
    job: (jobId: string) => `render:job:${jobId}`,
    /** A finished draft by the hash of its endpoint and inputs: the same prompt never renders twice. */
    cache: (inputHash: string) => `render:cache:${inputHash}`,
    /** The latest job for one world (a segment id, or "control") of one report, so a reload finds it. */
    latest: (reportId: string, segment: string) => `render:latest:${reportId}:${segment}`,
    /** Server-paid drafts ever (RENDERS_TOTAL_CAP). */
    total: "render:total",
    /** Server-paid drafts per judge pass. */
    pass: (passId: string) => `render:pass:${passId}`,
  },
  mcp: {
    /** A token record by the SHA-256 of the token; the token itself is never stored. */
    token: (tokenHash: string) => `mcp:token:${tokenHash}`,
    /** Every issued token hash, for listing and revoking (scripts/mcp-token.ts). */
    tokens: "mcp:tokens",
    /** One token's tool calls on one day. */
    calls: (tokenHash: string, day: string = dayOf()) => `mcp:token:${tokenHash}:calls:${day}`,
    /** One token's culture_brief runs on one day (they also count against LIVE_RUNS_DAILY_CAP). */
    cultureBriefs: (tokenHash: string, day: string = dayOf()) => `mcp:token:${tokenHash}:culture-briefs:${day}`,
  },
  /** Per-visitor limits in a time window: `window` is e.g. the hour or day the count belongs to. */
  rate: (name: string, visitor: VisitorId | CookieVisitorId, window: string) => `rate:${name}:${visitor}:${window}`,
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
