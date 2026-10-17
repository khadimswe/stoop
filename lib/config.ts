// Runtime switches and caps from the environment (CLAUDE.md sections 6 and 13), read in one place so
// the runtime, frames, revise, MCP and health agree. Pure: callers pass their env, so tests never
// touch the real one. Secrets are not read here; each vendor adapter reads its own key.

type Env = Readonly<Record<string, string | undefined>>;

const flag = (value: string | undefined) => value?.trim().toLowerCase() === "true";

function count(value: string | undefined, fallback: number): number {
  const text = value?.trim();
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`A daily cap must be a whole number of 0 or more, got "${text}".`);
  return parsed;
}

/** STOOP_LIVE: off (the default) means no live Qloo, Claude or fal call anywhere; examples replay. */
export function isLive(env: Env = process.env): boolean {
  return flag(env.STOOP_LIVE);
}

export interface DailyCaps {
  liveRuns: number;
  frames: number;
  qloo: number;
  renders: number;
}

/** Global daily caps, kept in Redis counters (keys.daily). Defaults from CLAUDE.md section 6. */
export function dailyCaps(env: Env = process.env): DailyCaps {
  return {
    liveRuns: count(env.LIVE_RUNS_DAILY_CAP, 30),
    frames: count(env.FRAMES_DAILY_CAP, 200),
    qloo: count(env.QLOO_DAILY_CAP, 500),
    // Renders stay off until Gate 8 sets a cap.
    renders: count(env.RENDERS_DAILY_CAP, 0),
  };
}

export interface VideoSwitches {
  /** The "Render draft" master switch (fal only, never Higgsfield). */
  liveVideo: boolean;
  /** Final-quality renders, on top of drafts. */
  finalRender: boolean;
}

export function videoSwitches(env: Env = process.env): VideoSwitches {
  return { liveVideo: flag(env.ENABLE_LIVE_VIDEO), finalRender: flag(env.ENABLE_LIVE_VIDEO) && flag(env.ENABLE_FINAL_RENDER) };
}

/** Server-paid draft renders per judge pass, whatever the day's cap. */
export const RENDERS_PER_PASS = 3;
/** Server-paid draft renders per IP per day, so one shared judge code cannot drain the day. */
export const RENDERS_PER_IP_DAILY = 6;

export interface RenderLimits {
  /** Server-paid drafts ever, across judging (RENDERS_TOTAL_CAP). 0 keeps server renders off. */
  total: number;
  perPass: number;
  perIpDaily: number;
  /** Seconds per draft (RENDER_DRAFT_SECONDS, 4 to 15): fal bills per second of video. */
  draftSeconds: number;
}

/** Limits on server-paid draft video, on top of dailyCaps().renders. BYOK renders bill the visitor's own fal key and pass none of these. */
export function renderLimits(env: Env = process.env): RenderLimits {
  const draftSeconds = count(env.RENDER_DRAFT_SECONDS, 15);
  if (draftSeconds < 4 || draftSeconds > 15) throw new Error(`RENDER_DRAFT_SECONDS must be 4 to 15, got ${draftSeconds}.`);
  return { total: count(env.RENDERS_TOTAL_CAP, 0), perPass: RENDERS_PER_PASS, perIpDaily: RENDERS_PER_IP_DAILY, draftSeconds };
}

/** "Render with your fal key": on unless ENABLE_BYOK is "false". It costs Stoop nothing, so it stays on through judging. */
export function byokEnabled(env: Env = process.env): boolean {
  return env.ENABLE_BYOK?.trim().toLowerCase() !== "false";
}

/** Storyboard world jobs (up to 8 frames each, with the re-renders) per visitor per day, on top of FRAMES_DAILY_CAP. */
export const STORYBOARD_LIMITS = { perCookieDaily: 6, perIpDaily: 15 } as const;

export interface McpCaps {
  /** Tool calls per day across every token (MCP_DAILY_CAP). */
  daily: number;
  /** Per token per day. culture_brief also counts against LIVE_RUNS_DAILY_CAP. */
  perToken: { calls: number; cultureBriefs: number };
  /** Token issuing, per IP per day and overall per day. */
  issue: { perIpDaily: number; daily: number };
}

export function mcpCaps(env: Env = process.env): McpCaps {
  return { daily: count(env.MCP_DAILY_CAP, 200), perToken: { calls: 40, cultureBriefs: 3 }, issue: { perIpDaily: 3, daily: 50 } };
}
