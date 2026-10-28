import type { ReactNode } from "react";
import type { ConceptView, ItemView } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { EmptyNote, PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

function ItemRow({ item }: { item: ItemView }) {
  return (
    <li className="flex flex-col gap-1.5 border-t border-hairline py-3 first:border-t-0 first:pt-0">
      <p className="font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">{item.kindLabel}</p>
      <p className="text-[0.9375rem] leading-relaxed text-pretty">
        <RichText parts={item.parts} quiet />
      </p>
      <div>
        <OriginTag origin={item.origin} receiptKey={item.receipt} context={item.kindLabel.toLowerCase()} />
      </div>
    </li>
  );
}

/**
 * The event: every line of the kept concept, each with where it came from ("Why Qloo picked this"
 * opens its receipt). The run of show, checklist, the generic comparison and the block sit below,
 * closed, one tap away (`more`).
 */
export function ConceptSection({ concept, pending, more }: { concept: ConceptView | null; pending?: boolean; more?: ReactNode }) {
  return (
    <PlanSection id="event" title="The plan">
      {!concept ? (
        <EmptyNote>{pending ? "Writing the plan..." : "No plan in this run."}</EmptyNote>
      ) : (
        <ul aria-label="Lines of the plan" className="flex flex-col rounded-xl border border-hairline bg-surface p-4 sm:p-5">
          {concept.items.map((item, i) => (
            <ItemRow key={`${item.kind}-${i}`} item={item} />
          ))}
        </ul>
      )}
      {more && <div className="flex flex-col border-t border-hairline">{more}</div>}
    </PlanSection>
  );
}
