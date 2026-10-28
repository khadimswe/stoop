import type { RunOfShowView, ShoppingView, TextPart } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { EmptyNote, PlanSection } from "./plan-section";
import { RefChip, RichText } from "./rich-text";

/**
 * The day, hour by hour: a printed-sheet timeline with times in mono. It sits beside the event
 * sheet on wide screens, so the first screen answers "what do I do Saturday".
 */
export function RunOfShowSection({ steps, pending, className }: { steps: readonly RunOfShowView[]; pending?: boolean; className?: string }) {
  return (
    <PlanSection id="run-of-show" title="The day, hour by hour" className={className}>
      {steps.length === 0 ? (
        <EmptyNote>{pending ? "The run of show comes with the full plan." : "No run of show in this plan."}</EmptyNote>
      ) : (
        <ol className="relative flex flex-col rounded-xl border border-hairline bg-surface px-4 py-2 sm:px-5">
          {steps.map((s, i) => (
            <li key={`${s.time}-${i}`} className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-3 border-b border-dashed border-hairline py-3 last:border-b-0">
              <time dateTime={s.time} className="pt-px font-mono text-sm font-medium text-ink">
                {s.timeLabel}
              </time>
              <p className="min-w-0 text-sm leading-relaxed text-pretty">
                <RichText parts={s.parts} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </PlanSection>
  );
}

/**
 * The shopping list as a receipt: item and quantity, the block partner to buy it from (a Qloo place,
 * with its receipt), and the estimate in mono, totalled against the budget.
 */
export function ShoppingSection({
  items,
  costLine,
  budgetText,
  totalText,
  pending,
}: {
  items: readonly ShoppingView[];
  costLine: string | null;
  budgetText: string;
  totalText: string | null;
  pending?: boolean;
}) {
  return (
    <PlanSection id="shopping" title="Shopping list" description={costLine ?? undefined}>
      {items.length === 0 ? (
        <EmptyNote>{pending ? "The shopping list comes with the full plan." : "No shopping list in this plan."}</EmptyNote>
      ) : (
        <div className="rounded-xl border border-hairline bg-surface px-4 py-2 sm:px-5">
          <ul className="flex flex-col">
            {items.map((s, i) => (
              <li key={`${s.item}-${i}`} className="flex flex-col gap-1 border-b border-dashed border-hairline py-3">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-pretty">{s.item}</p>
                  <span className={cn("shrink-0 font-mono text-sm", !s.costText && "text-ink-soft")}>{s.costText ?? "n/a"}</span>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                  {s.qty && <span>{s.qty}</span>}
                  {s.from ? (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {s.qty && <span aria-hidden="true">·</span>} from <RefChip name={s.from.name} receiptKey={s.from.receipt} className="mx-0" />
                    </span>
                  ) : (
                    <span>{s.qty && <span aria-hidden="true">· </span>}Creative suggestion (not from Qloo)</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
          {totalText && (
            <dl className="flex flex-col gap-1 py-3 font-mono text-sm">
              <div className="flex justify-between gap-3 font-semibold">
                <dt>Estimated total</dt>
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

/**
 * Permits and sidewalk rules, carrier brand rules, staffing and cleanup, as boxes to tick on the day.
 * Plain checkboxes: nothing is saved, so it works offline and without JavaScript.
 */
export function ChecklistSection({ items, pending }: { items: readonly TextPart[][]; pending?: boolean }) {
  return (
    <PlanSection id="checklist" title="Before you set up" description="Permits, brand rules, staff and cleanup. Tick them off; this list is not saved.">
      {items.length === 0 ? (
        <EmptyNote>{pending ? "The checklist comes with the full plan." : "No checklist in this plan."}</EmptyNote>
      ) : (
        <ul className="grid gap-x-6 rounded-xl border border-hairline bg-surface px-4 py-1 sm:px-5 md:grid-cols-2">
          {items.map((parts, i) => (
            <li key={i} className="border-b border-hairline last:border-b-0 md:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm leading-relaxed">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-ink" />
                <span className="min-w-0 text-pretty">
                  <RichText parts={parts} />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </PlanSection>
  );
}
