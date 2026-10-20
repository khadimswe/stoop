import { Check } from "lucide-react";
import { RealitySourceTag } from "@/components/stoop/reality-check-card";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { RealityDimensionView, RealityLineView, RealityView } from "@/lib/report/view/types";
import { cn } from "cn";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// The Reality Check, demo beat 1: "Your site speaks to X. You said Y. Qloo measured Z." in the gap
// stage's own words, then one row per dimension with its own outcome and margin. Nothing here forces
// a gap: a near tie reads "near tie", a confirmed read stays confirmed. Every Qloo line opens its receipt.

/** The measured line is the reveal; the others frame it. */
function Line({ line }: { line: RealityLineView }) {
  const reveal = line.kind === "measured" || line.kind === "confirmed";
  return (
    <li className="flex flex-col items-start gap-1.5 border-b border-hairline py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="sm:w-56 sm:shrink-0">{line.source && <RealitySourceTag source={line.source} />}</div>
      <div className="flex min-w-0 flex-col items-start gap-1">
        <p
          className={cn(
            reveal ? "font-display text-xl leading-snug font-bold text-ink [font-stretch:90%] sm:text-[1.375rem]" : "text-base",
            line.source === "generic" && "text-sm text-ink-soft",
          )}
        >
          {line.text}
        </p>
        {line.receipt && (
          <ReceiptDrawer receipt={line.receipt}>
            <Button variant="link" size="sm" className="h-auto min-h-11 focus-visible:outline-solid px-0 text-sm sm:min-h-9">
              See the receipts
            </Button>
          </ReceiptDrawer>
        )}
      </div>
    </li>
  );
}

const OUTCOME_STYLE: Record<RealityDimensionView["outcome"], string> = {
  gap: "border-ink bg-surface text-ink",
  near_tie: "border-dashed border-ink bg-surface text-ink",
  confirmed: "border-ink bg-ink text-paper",
  unverifiable: "border-concrete-line bg-surface text-ink-soft",
  not_stated: "border-transparent bg-fill text-ink-soft",
};

function Dimension({ d }: { d: RealityDimensionView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-3 sm:py-0">
      <dt className="flex items-center gap-2">
        <span className="text-sm font-semibold">{d.label}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 text-xs font-semibold", OUTCOME_STYLE[d.outcome])}>
          {d.outcome === "confirmed" && <Check aria-hidden="true" className="size-3" />}
          {d.outcomeLabel}
        </span>
      </dt>
      <dd className="flex flex-col gap-0.5 text-sm text-ink-soft">
        {d.stated && (
          <span>
            {d.statedBy === "site" ? "Read from your site" : "You said"}: <span className="text-ink">{d.stated}</span>
            {d.broad && " (a broad band, so a match says little)"}
          </span>
        )}
        {/* No evidence, no display: what Qloo measured shows only next to its receipt. */}
        {d.receipt ? (
          <span>
            Qloo: <span className="text-ink">{d.measured}</span>
          </span>
        ) : (
          <span>No Qloo signal</span>
        )}
        {d.margin && d.receipt && <span className="font-mono text-xs">{d.margin}</span>}
        {d.receipt && (
          <ReceiptDrawer receipt={d.receipt}>
            <Button variant="link" size="sm" className="h-auto min-h-11 focus-visible:outline-solid self-start px-0 text-sm text-ink sm:min-h-9" aria-label={`Receipt for ${d.label.toLowerCase()}`}>
              Receipt
            </Button>
          </ReceiptDrawer>
        )}
      </dd>
    </div>
  );
}

export function RealitySection({ view }: { view: RealityView | null }) {
  return (
    <ReportSection id={REPORT_SECTIONS.reality} title="Reality Check">
      {view ? (
        <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
          <ol className="flex flex-col">
            {view.lines.map((line, i) => (
              <Line key={`${i}-${line.kind}`} line={line} />
            ))}
          </ol>
          {view.dimensions.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-hairline pt-4">
              <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">By dimension</h3>
              <dl className="grid divide-y divide-hairline sm:grid-cols-2 sm:gap-x-6 sm:gap-y-4 sm:divide-y-0 lg:grid-cols-4">
                {view.dimensions.map((d) => (
                  <Dimension key={d.dimension} d={d} />
                ))}
              </dl>
            </div>
          )}
          <p className="border-t border-hairline pt-3 text-xs text-ink-soft">
            Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">The Reality Check appears once Qloo has measured the audience.</p>
      )}
    </ReportSection>
  );
}
