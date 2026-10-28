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

function Row({ row, theme }: { row: CompareRow; theme: string | null }) {
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
            <div key={i} className="flex flex-col gap-1.5">
              <p className={cn("text-pretty text-ink-soft", g.struck && "line-through decoration-rose-deep decoration-2")}>
                {g.struck && <span className="sr-only">Flagged as a cliché: </span>}
                {g.text}
              </p>
              {g.flags.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5 rounded-md bg-rose-soft px-2.5 py-1.5 text-rose-deep">
                  <p className="flex items-start gap-1.5 font-semibold">
                    <Flag aria-hidden="true" className="mt-1 size-3.5 shrink-0" />
                    <span>{f.kind === "cliche" ? `Cliché: ${f.label}` : f.label}</span>
                  </p>
                  {f.why && <p className="pl-5 text-pretty">{f.why}</p>}
                  {f.receipt && (
                    <span className="pl-5">
                      <ReceiptLink receiptKey={f.receipt} label="How Qloo checked" />
                    </span>
                  )}
                </div>
              ))}
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
          {generic.planCliches.length > 0 && (
            <ul aria-label="Clichés in the generic plan as a whole" className="flex flex-col gap-2">
              {generic.planCliches.map((c) => (
                <li key={c.text} className="flex flex-col gap-1 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose-deep sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
                    <Flag aria-hidden="true" className="size-3.5" />
                    Cliché: {c.text}
                  </span>
                  <span className="text-pretty">{c.why}</span>
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
                  <Row key={row.kind} row={row} theme={theme} />
                ))}
              </tbody>
            </table>
          </div>
          {generic.items.some((g) => g.struck) && (
            <p className="text-sm text-ink-soft">Struck through in rose: generic lines with no local signal behind them, flagged by Stoop&apos;s cliché check.</p>
          )}
        </>
      )}
    </PlanSection>
  );
}
