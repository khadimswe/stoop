import type { WheelView } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

/**
 * The prize wheel at the table is the store's own physical wheel, so the plan only suggests what to
 * write on each slice: the short label, the promo's full terms in small type, and for gift cards the
 * block place Qloo picked ("Why Qloo picked this"). The rules fit on one line.
 */
export function WheelSection({ wheel }: { wheel: WheelView }) {
  return (
    <PlanSection id="wheel" title="Prize wheel" description="Put these on your wheel.">
      <ol aria-label="Wheel slices" className="flex flex-col rounded-xl border border-hairline bg-surface px-4 sm:px-5">
        {wheel.slices.map((s) => (
          <li key={s.n} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-b border-hairline py-3 last:border-b-0">
            <span className="pt-0.5 font-mono text-sm text-ink-soft">{s.n}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-display text-lg leading-tight font-extrabold text-pretty [font-stretch:85%]">{s.label}</p>
              {s.text !== s.label && (
                <p className="text-xs text-pretty text-ink-soft">
                  <RichText parts={s.parts} quiet />
                </p>
              )}
              {s.kind !== "promo" && (
                <div>
                  <OriginTag origin={s.origin} receiptKey={s.receipt} context={`slice ${s.n}`} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {wheel.rules[0] && <p className="text-sm text-ink-soft">{wheel.rules[0]}</p>}
    </PlanSection>
  );
}
