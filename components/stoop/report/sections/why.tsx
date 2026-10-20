import type { WhyView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { CultureBriefCard } from "../why/culture-brief-card";
import { DimensionsCard, NeighborhoodCard, SeedsCard } from "../why/research-cards";
import { ScoreboardCard } from "../why/scoreboard-card";

/**
 * Why it works: the receipts half of the report. The seeds Qloo measured from, the Reality Check by
 * dimension, the taste neighborhood, a Culture Brief per world and the scored comparison with the
 * generic brief. Every number and every Qloo cue opens its receipt.
 */
export function WhySection({ view }: { view: WhyView }) {
  return (
    <ReportSection id={REPORT_SECTIONS.why} title="Why it works" description="The research, with receipts. Tap any number or Qloo chip to see the call behind it.">
      <div className="grid gap-3 lg:grid-cols-2">
        <SeedsCard seeds={view.seeds} />
        <DimensionsCard dimensions={view.dimensions} />
      </div>
      <NeighborhoodCard demographics={view.demographics} tags={view.tags} cities={view.cities} smallSetOnly={view.smallSetOnly} swinging={view.swinging} flags={view.flags} />
      {view.briefs.length > 0 && (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {view.briefs.map((brief) => (
            <CultureBriefCard key={brief.segmentId} brief={brief} />
          ))}
        </div>
      )}
      <ScoreboardCard scoreboard={view.scoreboard} />
      <p className="text-xs text-ink-soft">Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.</p>
    </ReportSection>
  );
}
