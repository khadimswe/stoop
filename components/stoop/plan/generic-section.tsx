import { Flag, PenLine } from "lucide-react";
import { Chip } from "@/components/stoop/chip";
import type { ComparisonView, ConceptView, GenericView } from "@/lib/plan/view/plan";
import { ReceiptLink } from "./receipt-link";
import { EmptyNote, PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

/**
 * The same store and inputs, planned by an AI with no Qloo: beside the kept concept, in a dashed
 * concrete frame (not from Qloo), with each cliche flagged in rose and why. The comparison lines are
 * the pipeline's own sentences, shown verbatim.
 */
export function GenericSection({
  concept,
  generic,
  comparison,
  pending,
}: {
  concept: ConceptView | null;
  generic: GenericView | null;
  comparison: ComparisonView | null;
  pending?: boolean;
}) {
  return (
    <PlanSection
      id="generic"
      kicker="Same store, no Qloo"
      title="The generic AI plan"
      description="The same inputs, planned by an AI without Qloo. This is the table every store already runs."
    >
      {!generic ? (
        <EmptyNote>{pending ? "Writing the generic plan to compare..." : "No generic plan in this run."}</EmptyNote>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dusk bg-surface p-4 sm:p-5">
              <p className="flex flex-wrap items-center gap-2">
                <Chip origin="qloo">Stoop plan</Chip>
                <span className="text-sm font-semibold">{concept?.title ?? "This store's plan"}</span>
              </p>
              {comparison && <p className="font-mono text-sm">{comparison.backedLine}</p>}
              <ul className="flex flex-col gap-2 text-sm">
                {(concept?.items ?? []).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-20 shrink-0 font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">{item.kindLabel}</span>
                    <span className="min-w-0 text-pretty">
                      <RichText parts={item.parts} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-dashed border-concrete-line bg-paper-raised p-4 sm:p-5" data-generic-plan>
              <p className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-concrete-line bg-surface px-2.5 py-1 text-[0.8125rem] leading-none font-semibold text-ink-soft">
                  <PenLine aria-hidden="true" className="size-3.5" />
                  Generic AI plan · not from Qloo
                </span>
              </p>
              {comparison && <p className="font-mono text-sm text-rose-deep">{comparison.clichesLine}</p>}
              <ul className="flex flex-col gap-2.5 text-sm">
                {generic.items.map((item, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">{item.kindLabel}</span>
                      <span className="min-w-0 text-pretty text-ink">{item.text}</span>
                    </div>
                    {item.flagged && (
                      <p className="ml-22 flex items-start gap-1.5 text-rose-deep">
                        <Flag aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-semibold">Cliché flagged: </span>
                          {item.flagged}
                        </span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {generic.cliches.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
              <p className="text-sm font-semibold">Clichés flagged in the generic plan</p>
              <ul className="flex flex-col gap-2">
                {generic.cliches.map((c) => (
                  <li key={c.text} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-3">
                    <Chip origin="flagged" className="self-start">
                      {c.text}
                    </Chip>
                    <span className="text-ink-soft">{c.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(generic.check || (comparison && comparison.lines.length > 0)) && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {generic.check && (
                <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{generic.check.line}</span>
                  <ReceiptLink receiptKey={generic.check.receipt} label="How Qloo checked it" />
                </li>
              )}
              {comparison?.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </PlanSection>
  );
}
