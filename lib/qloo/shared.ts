// What makes the Qloo client safe across many instances: a cache, a pacer and a daily cap kept in the
// shared store, plus the month remaining that the next run starts from (CLAUDE.md sections 2 and 6).
import { DAY_SECONDS, keys, TTL } from "../store/keys";
import type { Store } from "../store/types";
import type { QlooClientOptions } from "./client";
import { STARTS_PER_SECOND } from "./constants";
import { QlooBudgetError } from "./errors";
import { realSleep } from "./limiter";
import { StoreQlooCache } from "./redis-cache";

export const DAILY_CAP_MESSAGE = "Today's live Qloo calls are spent. The examples still work.";

export interface SharedOptions {
  /** QLOO_DAILY_CAP: fresh calls per day across the app. */
  dailyCap: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function sharedClientOptions(store: Store, options: SharedOptions): Pick<QlooClientOptions, "cache" | "pacer" | "admit" | "onMonthRemaining"> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  return {
    cache: new StoreQlooCache(store),
    // 4 starts per second across every instance: each attempt reserves the next 250 ms slot.
    pacer: async () => {
      const wait = await store.reserveSlot(keys.qloo.pacer, 1000 / STARTS_PER_SECOND, { now: now() });
      if (wait > 0) await sleep(wait);
    },
    admit: async () => {
      const used = await store.incr(keys.daily("qloo"), { ttlSeconds: TTL.daily });
      if (used > options.dailyCap) throw new QlooBudgetError(DAILY_CAP_MESSAGE);
    },
    onMonthRemaining: async (remaining) => {
      await store.set(keys.qloo.monthRemaining, remaining, { ttlSeconds: 35 * DAY_SECONDS });
    },
  };
}

/** The last month-remaining any instance saw, to seed a new run's monthly floor. */
export async function lastMonthRemaining(store: Store): Promise<number | undefined> {
  const value = await store.get<number>(keys.qloo.monthRemaining);
  return typeof value === "number" ? value : undefined;
}
