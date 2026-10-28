import type { RunOfShowView, ShoppingView, TextPart } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { Card, EmptyNote, PlanSection } from "./plan-section";
import { RefChip, RichText } from "./rich-text";

/** The day, step by step, with times in mono. */
export function RunOfShowSection({ steps, pending }: { steps: readonly RunOfShowView[]; pending?: boolean }) {
  return (
    <PlanSection id="run-of-show" title="Run of show">
      {steps.length === 0 ? (
        <EmptyNote>{pending ? "The run of show comes with the full plan." : "No run of show in this plan."}</EmptyNote>
      ) : (
        <Card>
          <ol className="flex flex-col">
            {steps.map((s, i) => (
              <li key={`${s.time}-${i}`} className="flex gap-4 border-b border-hairline py-2.5 first:pt-0 last:border-b-0 last:pb-0">
                <time dateTime={s.time} className="w-[4.5rem] shrink-0 pt-px font-mono text-sm font-medium text-ink">
                  {s.timeLabel}
                </time>
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-pretty">
                  <RichText parts={s.parts} />
                </p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </PlanSection>
  );
}

/** What to buy, how much, about what it costs, and the block partner to buy it from. */
export function ShoppingSection({ items, costLine, pending }: { items: readonly ShoppingView[]; costLine: string | null; pending?: boolean }) {
  return (
    <PlanSection id="shopping" title="Shopping list" description={costLine ?? undefined}>
      {items.length === 0 ? (
        <EmptyNote>{pending ? "The shopping list comes with the full plan." : "No shopping list in this plan."}</EmptyNote>
      ) : (
        <Card>
          <ul className="flex flex-col">
            {items.map((s, i) => (
              <li key={`${s.item}-${i}`} className="flex flex-col gap-1.5 border-b border-hairline py-3 first:pt-0 last:border-b-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold text-pretty">
                    {s.item}
                    {s.qty && <span className="font-normal text-ink-soft"> · {s.qty}</span>}
                  </p>
                  {s.costText && <span className="shrink-0 font-mono text-sm">{s.costText}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  {s.from && (
                    <span>
                      From <RefChip name={s.from.name} receiptKey={s.from.receipt} />
                    </span>
                  )}
                  <OriginTag origin={s.origin} receiptKey={s.receipt} context={s.item} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
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
    <PlanSection id="checklist" title="Checklist" description="Tick these off before and on the day. This list is not saved.">
      {items.length === 0 ? (
        <EmptyNote>{pending ? "The checklist comes with the full plan." : "No checklist in this plan."}</EmptyNote>
      ) : (
        <Card>
          <ul className="flex flex-col">
            {items.map((parts, i) => (
              <li key={i} className="border-b border-hairline last:border-b-0">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-sm leading-relaxed">
                  <input type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-ink" />
                  <span className="min-w-0 text-pretty">
                    <RichText parts={parts} />
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PlanSection>
  );
}
