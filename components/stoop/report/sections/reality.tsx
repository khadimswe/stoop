import { Button } from "@/components/ui/button";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import type { RealitySource, RealityView } from "@/lib/report/view/types";
import { cn } from "cn";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// Stub (report-top lane): the compact reveal, demo beat 1. Lines are the gap stage's own words, in
// order, each tagged with who it speaks for; Qloo lines open their receipt.
const SOURCE: Record<RealitySource, { label: string; className: string }> = {
  site: { label: "Read from your site · not from Qloo", className: "border-dashed border-concrete-line text-ink-soft" },
  you: { label: "You", className: "border-ink text-ink" },
  qloo: { label: "Qloo", className: "border-dusk bg-dusk text-paper" },
  generic: { label: "Generic AI brief · not from Qloo", className: "border-dashed border-concrete-line text-ink-soft" },
};

export function RealitySection({ view }: { view: RealityView | null }) {
  return (
    <ReportSection id={REPORT_SECTIONS.reality} title="Reality Check">
      {view ? (
        <ul className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
          {view.lines.map((line, i) => (
            <li key={`${i}-${line.kind}`} className="flex flex-col items-start gap-2 border-b border-hairline pb-3 last:border-b-0 last:pb-0">
              <p className={cn("text-base", line.kind === "measured" && "font-semibold")}>{line.text}</p>
              <div className="flex flex-wrap items-center gap-2">
                {line.source && (
                  <span className={cn("rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold", SOURCE[line.source].className)}>
                    {SOURCE[line.source].label}
                  </span>
                )}
                {line.receipt && (
                  <ReceiptDrawer receipt={line.receipt}>
                    <Button variant="link" size="sm">
                      See the receipts
                    </Button>
                  </ReceiptDrawer>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">The Reality Check appears once Qloo has measured the audience.</p>
      )}
    </ReportSection>
  );
}
