// Formatting for the live run's status line and footer. Real counts only: nothing here estimates a
// number except the dollar figure, which the run itself labels an estimate.
import type { Cost } from "../report/stages";
import type { CallCount } from "./rail";

/** "0:48", "1:05", "12:03" from milliseconds (negative clock skew reads 0:00). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "23 of 50 Qloo calls · 9 cached": live calls count against the run's cap; cached answers are free. */
export function callsLine(calls: CallCount, cap: number): string {
  return `${calls.live} of ${cap} Qloo calls · ${calls.cached} cached`;
}

/** The trace footer: "completed in 48 s · 31 Qloo calls · 9 cached · about $0.38". */
export function costLine(cost: Cost): string {
  const seconds = Math.max(1, Math.round(cost.durationMs / 1000));
  return [
    `completed in ${seconds} s`,
    plural(cost.qloo.live, "Qloo call", "Qloo calls"),
    `${cost.qloo.cached} cached`,
    `about $${cost.estimateUsd.toFixed(2)}`,
  ].join(" · ");
}

/** An example replay has no cost: it says what was replayed instead. */
export function replayLine(calls: CallCount): string {
  return `Recorded run · ${plural(calls.live + calls.cached, "Qloo answer", "Qloo answers")} replayed · no live calls`;
}
