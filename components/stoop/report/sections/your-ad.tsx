import { Chip } from "@/components/stoop/chip";
import { CopyButton } from "@/components/stoop/copy-button";
import type { YourAdView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { Storyboard } from "../storyboard";

// Stub (report-top lane): the top world's ad. Next: the pre-rendered clip on examples, "why it fits"
// with Qloo chips inline, and "See the receipts".
export function YourAdSection({ view }: { view: YourAdView | null }) {
  return (
    <ReportSection id={REPORT_SECTIONS.yourAd} title="Your ad" kicker={view ? `For ${view.worldLabel}` : undefined}>
      {view ? (
        <div className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
          <div className="flex flex-col items-start gap-1">
            <Chip origin="creative" showOrigin>
              Concept
            </Chip>
            <p className="font-display text-xl leading-snug font-bold [font-stretch:90%]">{view.hook}</p>
            <p className="text-sm text-ink-soft">
              {view.conceptTitle} · {view.emotion}
            </p>
          </div>
          <Storyboard view={view.storyboard} />
          <div className="flex flex-wrap gap-1">
            {view.prompt && <CopyButton text={view.prompt.prompt} label="Copy prompt" />}
            {view.script && <CopyButton text={view.script.script} label="Copy script" />}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">Your ad appears once the first concept world is written.</p>
      )}
    </ReportSection>
  );
}
