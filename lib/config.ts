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
