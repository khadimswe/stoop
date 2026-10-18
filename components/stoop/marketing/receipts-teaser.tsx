import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { TeaserView } from "@/lib/marketing/landing";
import { SectionIntro } from "./section-intro";
import { SourceTag } from "./source-tag";
import { StampOnView } from "./stamp-on-view";

/**
 * The receipts teaser: one honest number from the lead example (the with-vs-without headline and the
 * world's scoreboard line, verbatim), one cliche the check flagged with its receipt, and the way into
 * the judge's guide.
 */
export function ReceiptsTeaser({ view }: { view: TeaserView }) {
  return (
    <section id="receipts" aria-labelledby="receipts-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-wrap items-center gap-x-14 gap-y-10 px-5 py-20">
      <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-5">
        <SectionIntro
          id="receipts-title"
          kicker="Receipts"
          title="Every choice comes with a receipt."
          lead={view.headline ? `${view.brand}: ${view.headline}` : undefined}
        />
        {view.fitLine && (
          <p className="max-w-[40em] text-sm text-ink-soft">
            In {view.worldLabel}: {view.fitLine}.
          </p>
        )}
        <Link
          href="/judges"
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-base font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick"
        >
          For judges: everything Qloo decides
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      {view.cliche && (
        <div className="relative flex min-w-0 flex-[1_1_26rem] flex-col gap-5 rounded-card border-2 border-ink bg-surface p-6 shadow-float sm:p-7">
          <p className="type-kicker text-ink-soft">Cliche check · {view.brand}</p>
          <div className="flex flex-col items-start gap-2 border-b border-hairline pb-5">
            <p className="text-lg leading-snug font-semibold text-ink-soft">{view.cliche.assumed}</p>
            <SourceTag source="generic" />
          </div>
          <div className="flex flex-col items-start gap-2">
            <p className="font-display text-[1.5rem] leading-tight font-extrabold text-balance [font-stretch:85%]">{view.cliche.measured}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SourceTag source="qloo" />
              <ReceiptDrawer receipt={view.cliche.receipt}>
                <Button variant="link" size="sm" className="h-11">
                  See the receipt
                </Button>
              </ReceiptDrawer>
            </div>
          </div>
          <div className="absolute -top-5 right-5">
            <StampOnView tone="flagged">Cliche flagged</StampOnView>
          </div>
        </div>
      )}
    </section>
  );
}
