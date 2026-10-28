import type { RunOfShowView, ShoppingView, TextPart } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { EmptyNote, PlanSection } from "./plan-section";
import { RefChip, RichText } from "./rich-text";

/** The day, hour by hour, times in mono. Lives in a closed row under the plan. */
export function RunOfShow({ steps }: { steps: readonly RunOfShowView[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={`${s.time}-${i}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-b border-dashed border-hairline py-2.5 last:border-b-0">
          <time dateTime={s.time} className="pt-px font-mono text-sm font-medium">
            {s.timeLabel}
          </time>
          <p className="min-w-0 text-sm leading-relaxed text-pretty">
            <RichText parts={s.parts} quiet />
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Permits, brand rules, staff and cleanup as boxes to tick. Plain checkboxes: nothing is saved. */
export function Checklist({ items }: { items: readonly TextPart[][] }) {
  return (
    <ul className="flex flex-col">
      {items.map((parts, i) => (
        <li key={i} className="border-b border-hairline last:border-b-0">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm leading-relaxed">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-ink" />
            <span className="min-w-0 text-pretty">
              <RichText parts={parts} quiet />
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * The shopping list as a receipt: what to buy, how much, the block partner to buy it from (a Qloo
 * place, with its receipt) and the estimate in mono, totalled against the budget.
 */
export function ShoppingSection({ items, budgetText, totalText, pending }: { items: readonly ShoppingView[]; budgetText: string; totalText: string | null; pending?: boolean }) {
  return (
    <PlanSection id="shopping" title="Shopping">
      {items.length === 0 ? (
        <EmptyNote>{pending ? "The list comes with the plan." : "No shopping list."}</EmptyNote>
      ) : (
        <div className="rounded-xl border border-hairline bg-surface px-4 py-1 sm:px-5">
          <ul className="flex flex-col">
            {items.map((s, i) => (
              <li key={`${s.item}-${i}`} className="flex flex-col gap-1 border-b border-dashed border-hairline py-3">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-pretty">{s.item}</p>
                  <span className={cn("shrink-0 font-mono text-sm", !s.costText && "text-ink-soft")}>{s.costText ?? "n/a"}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-soft">
                  {s.qty && <span>{s.qty}</span>}
                  {s.from ? (
                    <>
                      {s.qty && <span aria-hidden="true">·</span>}
                      <span>from</span>
                      <RefChip name={s.from.name} receiptKey={s.from.receipt} className="mx-0" />
                    </>
                  ) : (
                    <>
                      {s.qty && <span aria-hidden="true">·</span>}
                      <span>Not from Qloo</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
          {totalText && (
            <dl className="flex flex-col gap-1 py-3 font-mono text-sm">
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Total</dt>
                <dd>{totalText}</dd>
              </div>
              <div className="flex justify-between gap-3 text-ink-soft">
                <dt>Budget</dt>
                <dd>{budgetText}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </PlanSection>
  );
}
