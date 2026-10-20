import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { ProofStatView } from "@/lib/marketing/proof";
import { CountUp } from "./count-up";
import { SectionIntro } from "./section-intro";
import { SourceTag } from "./source-tag";

/**
 * The proof band: big numbers from the recorded example runs, each answering a claim (the founder's
 * stated age, a generic AI brief's pick) with what Qloo measured, and each opening its receipt. The
 * numbers count up once as they scroll into view (the section's one motion) and are plain text
 * without JavaScript or with reduced motion.
 */
export function ProofStats({ stats }: { stats: ProofStatView[] }) {
  if (stats.length === 0) return null;
  return (
    <section id="proof" aria-labelledby="proof-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-10 px-5 pb-24">
      <SectionIntro
        id="proof-title"
        kicker="Proof from the examples"
        title="Founders guess. AI briefs guess. Qloo measures."
        lead="Numbers from the recorded example runs, on real Qloo responses: what the brand said or a generic AI brief picked, then what Qloo measured. Each one opens the Qloo calls behind it."
      />
      <ul className="grid border-t-2 border-ink md:grid-cols-2">
        {stats.map((stat, i) => (
          <li
            key={stat.id}
            className="flex min-w-0 flex-col items-start gap-3 border-b-2 border-ink py-8 md:px-8 md:odd:border-r-2 md:odd:pl-0 md:even:pr-0 lg:py-10"
          >
            <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h3 className="type-kicker text-ink-soft">{stat.brand}</h3>
              <span className="font-mono text-xs text-ink-soft">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <p className="text-base font-semibold text-ink">{stat.claim.text}</p>
              <SourceTag source={stat.claim.source} />
            </div>
            <p className="font-display leading-[0.85] font-extrabold text-dusk [font-stretch:75%]" style={{ fontSize: "clamp(4.5rem, 17vw, 7.25rem)", letterSpacing: "-0.03em" }}>
              <CountUp parts={stat.figure} />
            </p>
            <p className="max-w-[34ch] font-display text-[1.25rem] leading-tight font-bold text-balance [font-stretch:88%]">{stat.unit}</p>
            <p className="max-w-[48ch] text-sm leading-snug text-pretty text-ink-soft">{stat.detail}</p>
            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <SourceTag source="qloo" />
              <ReceiptDrawer receipt={stat.receipt}>
                {/* The spoken name starts with the visible words, then says which number it backs. */}
                <Button variant="link" size="sm" className="h-11" aria-label={`See the receipt: ${stat.brand}, ${stat.figureText}`}>
                  See the receipt
                </Button>
              </ReceiptDrawer>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
