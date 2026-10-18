import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { RealityCardView } from "@/lib/marketing/landing";
import { cn } from "cn";
import { SourceTag } from "./source-tag";

/**
 * Demo beat 1 on the landing: an example's Reality Check, in its own words. "This brand said X",
 * "Their site speaks to Y" (only when the run read a site), "Qloo measured Z" with its receipt, and
 * the generic AI brief's guess. Z is the audience around the product's taste neighborhood, never the
 * brand's actual buyers. Lines come from the recorded run, verbatim.
 */
export function RealityCard({ view, headingLevel = "h2", className }: { view: RealityCardView; headingLevel?: "h2" | "h3"; className?: string }) {
  const Heading = headingLevel;
  return (
    <section
      aria-labelledby={`reality-${view.slug}`}
      className={cn("relative flex min-w-0 flex-col gap-5 rounded-card border-2 border-ink bg-surface p-5 shadow-float sm:p-7", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading id={`reality-${view.slug}`} className="type-kicker text-ink-soft">
          Reality Check · {view.brand}
        </Heading>
        <ProvenanceBadge kind={view.provenance} date={view.date} />
      </div>
      <ul className="flex flex-col gap-4">
        {view.lines.map((line, i) => {
          const measured = line.kind === "measured";
          return (
            <li key={`${i}-${line.kind}`} className="flex flex-col items-start gap-2 border-b border-hairline pb-4 last:border-b-0 last:pb-0">
              <p
                className={cn(
                  measured
                    ? "font-display text-[1.45rem] leading-[1.12] font-extrabold tracking-tight text-pretty [font-stretch:85%] sm:text-[1.7rem]"
                    : line.kind === "said"
                      ? "text-lg leading-snug font-semibold"
                      : "text-base leading-snug text-ink-soft",
                )}
              >
                {line.text}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {line.source && <SourceTag source={line.source} />}
                {line.receipt && (
                  <ReceiptDrawer receipt={line.receipt}>
                    <Button variant="link" size="sm" className="h-9">
                      See the receipts
                    </Button>
                  </ReceiptDrawer>
                )}
              </div>
              {measured && (
                <p className="text-sm text-ink-soft">
                  The audience around the product&apos;s taste neighborhood: who it is, what else they love, where they cluster.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-4">
        {view.receiptLine && <p className="min-w-0 font-mono text-xs break-words text-ink-soft">{view.receiptLine}</p>}
        <Link
          href={`/examples/${view.slug}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick"
        >
          Open the full report
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}
