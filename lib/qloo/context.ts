import { createLedger, type Ledger } from "../evidence";
import { RUN_CAP } from "./budget";

/** Per-run state shared by every Qloo call in one agent run. */
export interface RunContext {
  readonly runId: string;
  /** Max live calls for this run. */
  readonly cap: number;
  /** Stop live calls when Qloo reports fewer than this many calls left this month. */
  readonly monthlyFloor: number;
  liveCalls: number;
  cachedCalls: number;
  /** Last `x-month-ratelimit-remaining` value Qloo reported. */
  monthRemaining?: number;
  /** Live calls spent per stage, for the trace and the budget table. */
  stageCalls: Record<string, number>;
  readonly ledger: Ledger;
}

export function createRunContext(options: { runId: string; cap?: number; monthlyFloor?: number }): RunContext {
  return {
    runId: options.runId,
    cap: options.cap ?? RUN_CAP,
    monthlyFloor: options.monthlyFloor ?? 0,
    liveCalls: 0,
    cachedCalls: 0,
    stageCalls: {},
    ledger: createLedger(options.runId),
  };
}
