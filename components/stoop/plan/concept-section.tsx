import type { ConceptView, ItemView } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { EmptyNote, PlanSection } from "./plan-section";
import { RichText } from "./rich-text";

/** A block place a line names, with Qloo's own "why" quoted under it: the receipt you can read. */
function PlaceWhy({ place }: { place: ItemView["places"][number] }) {
  if (!place.why && !place.distanceText) return null;
  return (
    <div className="flex flex-col gap-1 border-l-[3px] border-dusk py-0.5 pl-3 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{place.name}</span>
        {place.distanceText && <span className="font-mono text-xs text-ink-soft">{place.distanceText} from the store</span>}
      </p>
      {place.why && (
        <p className="text-pretty">
          <span className="font-semibold text-dusk">Qloo&apos;s why: </span>
          {place.why}
        </p>
      )}
    </div>
  );
}

function ItemRow({ item }: { item: ItemView }) {
  return (
    <li className="grid gap-x-4 gap-y-1.5 border-t border-hairline py-3.5 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <p className="pt-0.5 font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">{item.kindLabel}</p>
      <div className="flex min-w-0 flex-col gap-2.5">
        <p className="text-[0.9375rem] leading-relaxed text-pretty">
          <RichText parts={item.parts} />
        </p>
        {item.places.map((p) => (
          <PlaceWhy key={p.id} place={p} />
        ))}
        <div>
          <OriginTag origin={item.origin} receiptKey={item.receipt} context={item.kindLabel.toLowerCase()} />
        </div>
      </div>
    </li>
  );
}

/**
 * Every line of the kept concept with its origin. Measured artists and places appear by name as dusk
 * chips that open their receipts, and a named block place shows Qloo's own "why" under the line.
 * The rubric score and the concepts that were not kept stay folded.
 */
export function ConceptSection({ concept, alternatives, pending }: { concept: ConceptView | null; alternatives: readonly ConceptView[]; pending?: boolean }) {
  const backed = concept ? concept.items.filter((i) => i.origin === "qloo" || i.origin === "interpreted").length : 0;
  return (
    <PlanSection
      id="plan"
      title="The plan, line by line"
      description={concept ? `${backed} of ${concept.items.length} lines come from what Qloo measured. Tap a name for its receipt.` : undefined}
    >
      {!concept ? (
        <EmptyNote>{pending ? "Writing three event concepts from your city and your block..." : "No event concept in this plan."}</EmptyNote>
      ) : (
        <>
          <ul aria-label="Lines of the plan" className="flex flex-col border-b border-hairline">
            {concept.items.map((item, i) => (
              <ItemRow key={`${item.kind}-${i}`} item={item} />
            ))}
          </ul>
          <details className="group/alts text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-sm font-semibold text-ink underline decoration-1 underline-offset-4 hover:decoration-brick sm:min-h-8 [&::-webkit-details-marker]:hidden">
              Why this concept: scored <span className="font-mono">{concept.total}</span> of <span className="font-mono">{concept.max}</span>
              {alternatives.length > 0 && <> against {alternatives.length === 1 ? "1 other" : `${alternatives.length} others`}</>}
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <table className="w-full text-sm">
                <caption className="sr-only">Rubric scores for the kept concept</caption>
                <tbody>
                  {concept.scores.map((s) => (
                    <tr key={s.criterion} className="border-b border-hairline">
                      <th scope="row" className="py-1.5 text-left font-normal">
                        {s.criterion}
                      </th>
                      <td className="py-1.5 text-right font-mono">{s.score} of 5</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {alternatives.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {alternatives.map((alt) => (
                    <li key={alt.id} className="flex flex-col gap-0.5">
                      <p className="font-semibold">
                        {alt.title} <span className="font-mono font-normal text-ink-soft">{alt.total} of {alt.max}</span>
                      </p>
                      <p className="text-pretty text-ink-soft">{alt.hook}</p>
                      {alt.note && <p className="text-pretty text-ink-soft">{alt.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      )}
    </PlanSection>
  );
}
