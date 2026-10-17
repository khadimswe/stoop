import { createLedger, type Ledger } from "../evidence";
import { RUN_BUDGET, RUN_CAP } from "./budget";

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
  /** Per-row caps (lib/qloo/budget.ts RUN_BUDGET); a request tagged with a spent row is refused. */
  readonly rowCaps: Readonly<Record<string, number>>;
  /** Live calls spent per budget row. */
  rowCalls: Record<string, number>;
  /** Live retries so far: with row caps, they may only use the cap's slack (cap minus the planned rows). */
  retryCalls: number;
  readonly ledger: Ledger;
}

export function createRunContext(options: { runId: string; cap?: number; monthlyFloor?: number; rowCaps?: Readonly<Record<string, number>> }): RunContext {
  return {
    runId: options.runId,
    cap: options.cap ?? RUN_CAP,
    monthlyFloor: options.monthlyFloor ?? 0,
    liveCalls: 0,
    cachedCalls: 0,
    stageCalls: {},
    rowCaps: options.rowCaps ?? {},
    rowCalls: {},
    retryCalls: 0,
    ledger: createLedger(),
  };
}

/** A live run's context: the run cap plus the per-row table, so every call is planned and capped. */
export function createLiveRunContext(runId: string, options: { monthlyFloor?: number } = {}): RunContext {
  return createRunContext({ runId, cap: RUN_CAP, rowCaps: RUN_BUDGET, ...options });
}
