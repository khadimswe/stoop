import { Info } from "lucide-react";
import { ACCOUNT_NOTE, CALL_GENERIC, callLine, NO_WINNER, paceLine, PILOT_NOTE, RULE_STEPS, type BudgetSplit } from "@/lib/report/view/launch-sheet";

/**
 * How to call the test, relative to the Control: when (from the brand's own target or test days),
 * then keep the worlds that beat the Control's cost per result and move the rest of the budget to
 * the best one. Then the honest note: this measures the lift, Stoop does not claim it.
 */
export function DecisionRule({ split }: { split: BudgetSplit | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5" data-launch-rule>
      <h3 className="text-base font-semibold">How to call it</h3>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm marker:font-mono marker:text-ink-soft">
        <li>
          {split ? (
            <>
              {callLine(split)} <span className="text-ink-soft">{paceLine(split)}</span>
            </>
          ) : (
            CALL_GENERIC
          )}
        </li>
        {RULE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-sm text-ink-soft">{NO_WINNER}</p>
      <div className="flex items-start gap-2 rounded-lg bg-fill px-3 py-2.5 text-sm">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-soft" />
        <p>
          {PILOT_NOTE} {ACCOUNT_NOTE}
        </p>
      </div>
    </div>
  );
}
