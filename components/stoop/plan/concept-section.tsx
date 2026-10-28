import type { ConceptView, ItemView } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { Card, EmptyNote, PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

function ItemRow({ item }: { item: ItemView }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-hairline py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
      <p className="w-24 shrink-0 pt-0.5 font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">{item.kindLabel}</p>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[0.9375rem] leading-relaxed text-pretty">
          <RichText parts={item.parts} />
        </p>
        <div>
          <OriginTag origin={item.origin} receiptKey={item.receipt} context={item.kindLabel.toLowerCase()} />
        </div>
      </div>
    </li>
  );
}

function ScoreLine({ concept }: { concept: ConceptView }) {
  if (concept.scores.length === 0) return null;
  return (
    <details className="group/score text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm font-semibold text-ink-soft underline decoration-1 underline-offset-4 hover:text-ink sm:min-h-8 [&::-webkit-details-marker]:hidden">
        Scored <span className="font-mono">{concept.total}</span> of <span className="font-mono">{concept.max}</span> on the event rubric
      </summary>
      <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {concept.scores.map((s) => (
          <li key={s.criterion} className="flex justify-between gap-3 border-b border-hairline py-1">
            <span>{s.criterion}</span>
            <span className="font-mono">{s.score} of 5</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The kept concept: its title and hook (why someone walking by stops), then every line of the plan
 * with its origin. Measured artists and places appear by name as dusk chips that open their receipts.
 * The other concepts stay folded with their scores and why they were not kept.
 */
export function ConceptSection({ concept, alternatives, pending }: { concept: ConceptView | null; alternatives: readonly ConceptView[]; pending?: boolean }) {
  if (!concept) {
    return (
      <PlanSection id="plan" kicker="The event" title="The event">
        <EmptyNote>{pending ? "Writing three event concepts from your city and your block..." : "No event concept in this plan."}</EmptyNote>
      </PlanSection>
    );
  }
  return (
    <PlanSection id="plan" kicker="The event" title={concept.title}>
      <Card className="flex flex-col gap-4">
        <p className="font-display text-xl leading-snug font-bold text-pretty [font-stretch:90%]">{concept.hook}</p>
        <ScoreLine concept={concept} />
        <ul aria-label="What's in the plan" className="flex flex-col">
          {concept.items.map((item, i) => (
            <ItemRow key={`${item.kind}-${i}`} item={item} />
          ))}
        </ul>
      </Card>
      {alternatives.length > 0 && (
        <details className="group/alts rounded-xl border border-hairline bg-surface px-4 sm:px-5">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              {alternatives.length === 1 ? "The other concept Stoop wrote" : `The other ${alternatives.length} concepts Stoop wrote`}
            </span>
            <span className="text-ink-soft underline decoration-1 underline-offset-4 group-open/alts:hidden">Show</span>
            <span className="hidden text-ink-soft underline decoration-1 underline-offset-4 group-open/alts:inline">Hide</span>
          </summary>
          <ul className="flex flex-col gap-4 border-t border-hairline py-4">
            {alternatives.map((alt) => (
              <li key={alt.id} className="flex flex-col gap-1">
                <p className="font-display text-lg leading-snug font-bold [font-stretch:90%]">{alt.title}</p>
                <p className="text-sm text-pretty">{alt.hook}</p>
                <p className="font-mono text-xs text-ink-soft">
                  Scored {alt.total} of {alt.max}
                </p>
                {alt.note && <p className="text-sm text-ink-soft">Not kept: {alt.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </PlanSection>
  );
}
