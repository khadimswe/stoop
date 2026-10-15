import pLimit from "p-limit";
import { MAX_IN_FLIGHT, STARTS_PER_SECOND } from "./constants";

export interface LimiterOptions {
  startsPerSecond?: number;
  maxInFlight?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Limiter {
  /**
   * Runs `task` with at most `maxInFlight` tasks at once. Identical keys that are already in flight
   * share one promise, so two stages asking the same question cost one call.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** True when a task for this key is already running, so a new caller would share it. */
  inFlight(key: string): boolean;
  /** Waits for the next request start slot. Call before every attempt, including retries. */
  pace(): Promise<void>;
}

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Keeps Qloo under its 5 requests/second limit: 4 starts per second, evenly spaced. */
export function createLimiter(options: LimiterOptions = {}): Limiter {
  const spacingMs = 1000 / (options.startsPerSecond ?? STARTS_PER_SECOND);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const limit = pLimit(options.maxInFlight ?? MAX_IN_FLIGHT);
  const inFlight = new Map<string, Promise<unknown>>();
  let nextStart = 0;

  async function pace(): Promise<void> {
    const current = now();
    const start = Math.max(current, nextStart);
    nextStart = start + spacingMs;
    if (start > current) await sleep(start - current);
  }

  function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = limit(task).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  return { run, pace, inFlight: (key) => inFlight.has(key) };
}
