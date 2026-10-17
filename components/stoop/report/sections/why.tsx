import { SeedChip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { WhyView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// Stub (report-bottom lane): the seeds with their origins, the top stable cities by lift (each opens
// its receipt) and the with-vs-without headline. Next: the full Reality Check, skew bars, Culture
// Briefs and the scoreboard.
export function WhySection({ view }: { view: WhyView }) {
  return (
    <ReportSection id={REPORT_SECTIONS.why} title="Why it works" description="The research, with receipts.">
      <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Qloo measured from these seeds</h3>
          <ul className="flex flex-wrap gap-2">
            {view.seeds.map((seed) => (
              <li key={`${seed.kind}-${seed.name}`}>
                <SeedChip origin={seed.origin} name={seed.name} kind={seed.kind} />
              </li>
            ))}
          </ul>
        </div>
        {view.cities.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Top cities by lift</h3>
            <ul className="flex flex-wrap items-center gap-x-1">
              {view.cities.map((city) => (
                <li key={city.label}>
                  {city.receipt ? (
                    <ReceiptDrawer receipt={city.receipt}>
                      <Button variant="link" size="sm">
                        {city.label}
                      </Button>
                    </ReceiptDrawer>
                  ) : (
                    <span className="text-sm">{city.label}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-soft">Ranked against {view.cities[0].comparedWith} reference audiences. A city sets the scene, never the cast.</p>
          </div>
        )}
        {view.comparisonHeadline && <p className="text-sm font-semibold">{view.comparisonHeadline}</p>}
        <p className="border-t border-hairline pt-3 text-xs text-ink-soft">
          Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.
        </p>
      </div>
    </ReportSection>
  );
}
