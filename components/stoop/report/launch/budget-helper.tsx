"use client";

import { CircleAlert } from "lucide-react";
import { useId, type FormEvent } from "react";
import { cn } from "cn";
import { BOTH_PLATFORMS, leftoverLine, splitLine, type BudgetErrors, type BudgetField, type BudgetInput, type BudgetSplit } from "@/lib/report/view/launch-sheet";

const FIELDS: readonly {
  field: BudgetField;
  label: string;
  optional?: boolean;
  prefix?: string;
  inputMode: "decimal" | "numeric";
  hint: string;
}[] = [
  { field: "daily", label: "Daily budget", prefix: "$", inputMode: "decimal", hint: "All cells together, in US dollars." },
  { field: "days", label: "Test days", inputMode: "numeric", hint: "How long every cell runs." },
  {
    field: "target",
    label: "Target cost per result",
    optional: true,
    prefix: "$",
    inputMode: "decimal",
    hint: "What one sale or lead is worth to you. Leave it empty to call the test after the test days.",
  },
];

/**
 * The budget helper: the brand's daily budget, test days and an optional target cost per result,
 * validated as they type, and the even split across every cell (the Control included). Errors show
 * once a field has been left or holds something that is not a number; the summary is a polite live
 * region, so the new split is read out without moving focus.
 */
export function BudgetHelper({
  cells,
  input,
  errors,
  touched,
  split,
  onChange,
  onBlur,
}: {
  cells: number;
  input: BudgetInput;
  errors: BudgetErrors;
  touched: Partial<Record<BudgetField, boolean>>;
  split: BudgetSplit | null;
  onChange: (field: BudgetField, value: string) => void;
  onBlur: (field: BudgetField) => void;
}) {
  const id = useId();
  const leftover = split && leftoverLine(split);
  const shown = (field: BudgetField) => (touched[field] || input[field].trim() !== "" ? errors[field] : undefined);
  const submit = (event: FormEvent) => event.preventDefault();

  return (
    <form noValidate onSubmit={submit} aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-base font-semibold">
          Budget
        </h3>
        <p className="text-sm text-ink-soft">Split evenly across all {cells} cells, the Control included, so every ad gets the same chance.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {FIELDS.map(({ field, label, optional, prefix, inputMode, hint }) => {
          const error = shown(field);
          const inputId = `${id}-${field}`;
          return (
            <div key={field} className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={inputId} className="text-[0.8125rem] font-semibold">
                {label}
                {optional && <span className="font-normal text-ink-soft"> (optional)</span>}
              </label>
              <div className="relative">
                {prefix && (
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-ink-soft">
                    {prefix}
                  </span>
                )}
                <input
                  id={inputId}
                  name={field}
                  type="text"
                  inputMode={inputMode}
                  autoComplete="off"
                  spellCheck={false}
                  value={input[field]}
                  onChange={(event) => onChange(field, event.target.value)}
                  onBlur={() => onBlur(field)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
                  className={cn(
                    "h-11 w-full min-w-0 rounded-lg border border-concrete-line bg-fill px-3 text-base text-ink aria-invalid:border-2 aria-invalid:border-ink",
                    prefix && "pl-7",
                  )}
                />
              </div>
              <p id={`${inputId}-hint`} className="text-xs text-ink-soft">
                {hint}
              </p>
              {error && (
                <p id={`${inputId}-error`} className="flex items-start gap-1.5 text-xs font-semibold text-ink">
                  <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div role="status" className="flex flex-col gap-1 rounded-lg bg-fill px-3 py-2.5 text-sm" data-launch-split>
        {split ? (
          <>
            <p className="font-mono text-[0.8125rem] font-medium">{splitLine(split)}</p>
            {leftover && <p className="text-ink-soft">{leftover}</p>}
            <p className="text-xs text-ink-soft">{BOTH_PLATFORMS}</p>
          </>
        ) : (
          <p className="text-ink-soft">Enter a daily budget and the test days to see the split.</p>
        )}
      </div>
    </form>
  );
}
