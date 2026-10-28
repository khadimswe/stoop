import { BadgeCheck, Flag, PenLine } from "lucide-react";
import type { ComparisonView, CompareRow, GenericView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { EmptyNote, PlanSection } from "./plan-section";
import { ReceiptLink } from "./receipt-link";
import { RichText } from "./rich-text";

const STOOP_HEAD = (
  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-dusk">
    <BadgeCheck aria-hidden="true" className="size-4" />
    Stoop plan, from Qloo
  </span>
);
const GENERIC_HEAD = (
  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
    <PenLine aria-hidden="true" className="size-4" />
    Generic AI plan, not from Qloo
  </span>
);

function Row({ row, checkReceipt, theme }: { row: CompareRow; checkReceipt: string | null; theme: string | null }) {
  return (
    <tr className="grid gap-x-6 gap-y-2 border-t border-hairline py-4 md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
      <th scope="row" className="text-left font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase md:pt-0.5">
        {row.kindLabel}
      </th>
      <td className="flex flex-col gap-2 text-sm leading-relaxed">
        <span className="font-mono text-[0.6875rem] tracking-wide text-dusk uppercase md:hidden">Stoop</span>
        {row.stoop.length === 0 && row.kind === "theme" && theme ? (
          <p className="font-semibold text-pretty">{theme}</p>
        ) : row.stoop.length === 0 ? (
          <span className="text-ink-soft">Nothing on this line.</span>
        ) : (
          row.stoop.map((item, i) => (
            <p key={i} className="text-pretty">
              <RichText parts={item.parts} />
            </p>
          ))
        )}
      </td>
      <td className="flex flex-col gap-2 border-dashed border-concrete-line text-sm leading-relaxed max-md:border-t max-md:pt-2 md:border-l md:pl-6">
        <span className="font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase md:hidden">Generic</span>
        {row.generic.length === 0 ? (
          <span className="text-ink-soft">Nothing on this line.</span>
        ) : (
          row.generic.map((g, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p className={cn("text-pretty text-ink-soft", g.flagged && "line-through decoration-rose-deep decoration-2")}>{g.text}</p>
              {g.flagged && (
                <p className="flex items-start gap-1.5 text-rose-deep">
                  <Flag aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
                  <span>
                    <span className="font-semibold">Cliché: </span>
                    {g.flagged}
                  </span>
                </p>
              )}
              {g.checked && (
                <p className="flex flex-wrap items-start gap-x-2 gap-y-1 text-rose-deep">
                  <span className="inline-flex items-start gap-1.5">
                    <Flag aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
                    <span className="font-semibold">{g.checked}</span>
                  </span>
                  <ReceiptLink receiptKey={checkReceipt} label="How Qloo checked" />
                </p>
              )}
            </div>
          ))
        )}
      </td>
    </tr>
  );
}

/**
 * The same store and inputs, planned by an AI with no Qloo, row by row beside the Stoop plan: dusk
 * for Qloo, dashed concrete for the generic plan, rose for what Qloo's check or the cliche list
 * flagged (cliches struck through, with why). The comparison sentences are the pipeline's own, verbatim.
 */
export function GenericSection({
  generic,
  comparison,
  city,
  theme,
  pending,
}: {
  generic: GenericView | null;
  comparison: ComparisonView | null;
  city: string;
  /** The kept concept's title, which is the Stoop plan's theme line. */
  theme: string | null;
  pending?: boolean;
}) {
  return (
    <PlanSection
      id="generic"
      kicker="Same store, no Qloo"
      title="What a generic AI plan looks like"
      description={`The same store, day and promos, planned by an AI that knows nothing about ${city} or this block. This is the table every store already runs.`}
    >
      {!generic ? (
        <EmptyNote>{pending ? "Writing the generic plan to compare..." : "No generic plan in this run."}</EmptyNote>
      ) : (
        <>
          {comparison && comparison.lines.length > 0 && (
            <ul className="flex flex-col gap-1 border-l-[3px] border-ink pl-4 text-[0.9375rem] leading-relaxed">
              {comparison.lines.map((line) => (
                <li key={line} className="text-pretty">
                  {line}
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-xl border border-hairline bg-surface px-4 sm:px-5">
            <table className="w-full">
              <caption className="sr-only">The Stoop plan and the generic AI plan, line by line</caption>
              <thead className="max-md:sr-only">
                <tr className="grid gap-x-6 py-3 md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
                  <th scope="col" className="text-left font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">
                    Line
                  </th>
                  <th scope="col" className="text-left">
                    {STOOP_HEAD}
                  </th>
                  <th scope="col" className="text-left md:pl-6">
                    {GENERIC_HEAD}
                  </th>
                </tr>
              </thead>
              <tbody>
                {generic.rows.map((row) => (
                  <Row key={row.kind} row={row} checkReceipt={generic.check?.receipt ?? null} theme={theme} />
                ))}
              </tbody>
            </table>
          </div>
          {generic.cliches.length > 0 && (
            <p className="text-sm text-ink-soft">
              Struck through in rose: generic choices with no local signal behind them, flagged by Stoop&apos;s cliché check.
            </p>
          )}
        </>
      )}
    </PlanSection>
  );
}
