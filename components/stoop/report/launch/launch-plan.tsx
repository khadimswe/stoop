"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { BUDGET_DEFAULTS, planBudget, type BudgetField, type BudgetInput } from "@/lib/report/view/launch-sheet";
import type { LaunchPlanView } from "@/lib/report/view/types";
import { BudgetHelper } from "./budget-helper";
import { DecisionRule } from "./decision-rule";
import { LaunchCell } from "./launch-cell";
import { LaunchExport } from "./launch-export";

const noSubscription = () => () => {};

/** The report's absolute URL for the sheet's prompt links; null on the server. */
function usePageUrl(reportPath: string | undefined): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => `${window.location.origin}${reportPath ?? window.location.pathname}`,
    () => null,
  );
}

const GRID: Record<number, string> = { 2: "md:grid-cols-2", 3: "md:grid-cols-2 lg:grid-cols-3", 4: "md:grid-cols-2 xl:grid-cols-4" };

/**
 * The interactive part of the Launch plan: the budget helper owns the numbers, and the cells, the
 * rule and the launch sheet all read the same split. `reportPath` is the report the cells' prompt
 * links point at (default: this page).
 */
export function LaunchPlan({ view, reportPath }: { view: LaunchPlanView; reportPath?: string }) {
  const [input, setInput] = useState<BudgetInput>({ ...BUDGET_DEFAULTS });
  const [touched, setTouched] = useState<Partial<Record<BudgetField, boolean>>>({});
  const result = useMemo(() => planBudget(input, view.cells.length), [input, view.cells.length]);
  const split = result.ok ? result.split : null;
  const pageUrl = usePageUrl(reportPath);

  return (
    <div className="flex flex-col gap-4">
      <BudgetHelper
        cells={view.cells.length}
        input={input}
        errors={result.ok ? {} : result.errors}
        touched={touched}
        split={split}
        onChange={(field, value) => setInput((prev) => ({ ...prev, [field]: value }))}
        onBlur={(field) => setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))}
      />
      <ul aria-label="Test cells" className={cn("grid gap-3", GRID[view.cells.length] ?? GRID[3])}>
        {view.cells.map((cell) => (
          <li key={cell.key} className="min-w-0">
            <LaunchCell cell={cell} dailyCents={split?.perCellDailyCents ?? null} promptsHref={`${reportPath ?? ""}#${cell.creative.anchor}`} />
          </li>
        ))}
      </ul>
      <p className="max-w-[80ch] text-xs text-ink-soft">{view.optionsNote}</p>
      {view.skipped.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-soft">
          {view.skipped.map((s) => (
            <li key={s.label}>
              Not in this test: {s.label}. {s.reason}
            </li>
          ))}
        </ul>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <DecisionRule split={split} />
        <LaunchExport view={view} split={split} pageUrl={pageUrl} />
      </div>
    </div>
  );
}
