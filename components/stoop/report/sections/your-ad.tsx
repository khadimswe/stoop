import { Chip } from "@/components/stoop/chip";
import { CopyButton } from "@/components/stoop/copy-button";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import type { YourAdView } from "@/lib/report/view/your-ad";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { CueChips } from "../screening/cue-chip";
import { ConceptPoster, firstFrame } from "../storyboard";

// "Your ad": the top world's ad in one card. The poster is frame 1 of its storyboard (the approved
// clip plays over it when there is one); until frames exist it is the concept preview: the hook line
// and the first shot. Then the hook, one sentence on why it fits with the Qloo cues it stands on, and
// the copy actions. Copy buttons are text buttons: the brick sticky bar is the page's one primary.
export function YourAdSection({ view }: { view: YourAdView | null }) {
  if (!view) {
    return (
      <ReportSection id={REPORT_SECTIONS.yourAd} title="Your ad">
        <p className="text-sm text-ink-soft">Your ad appears once the first concept world is written.</p>
      </ReportSection>
    );
  }
  const poster = firstFrame(view.storyboard);
  const qloo = view.cues.filter((c) => c.receipt !== null);
  const creative = view.cues.filter((c) => c.receipt === null);
  return (
    <ReportSection id={REPORT_SECTIONS.yourAd} title="Your ad" kicker={`For ${view.worldLabel}`}>
      {/* Phones: the poster with the hook beside it, the rest below. From sm up: the poster spans the left column. */}
      <article
        aria-labelledby="your-ad-hook"
        className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-4 rounded-xl border border-hairline bg-surface p-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:grid-rows-[auto_1fr] sm:gap-x-6 sm:p-5 lg:grid-cols-[13rem_minmax(0,1fr)]"
      >
        <Screen variant="app" className="self-start p-1.5 sm:row-span-2">
          <VideoTile
            label="Culture-made"
            tone="culture"
            src={view.clip?.src}
            poster={view.clip?.poster ?? poster?.src}
            captions={view.clip?.captions ?? undefined}
            preview={<ConceptPoster view={view.storyboard} hookLine={view.hookLine} fallbackTitle={view.conceptTitle} />}
            className="rounded-xl"
          />
        </Screen>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Hook view={view} id="your-ad-hook" />
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-4 sm:col-span-1 sm:col-start-2">
          {/* The small phone poster leaves out the first shot, so it is spelled out here. */}
          <p className="text-sm text-ink-soft sm:hidden">
            <span className="font-semibold text-ink">Opens on: </span>
            {view.opening}
          </p>
          {view.whyItFits && (
            <div className="flex flex-col gap-2.5">
              <p className="text-sm text-ink">
                <span className="font-semibold">Why it fits: </span>
                {view.whyItFits}
              </p>
              <CueChips cues={qloo} label="From Qloo:" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-ink-soft">Not from Qloo:</span>
            <ul aria-label="Not from Qloo" className="flex flex-wrap gap-1.5">
              <li className="flex">
                <Chip origin="creative">Concept</Chip>
              </li>
              {creative.map((c) => (
                <li key={c.slot} className="flex">
                  <Chip origin="creative">{c.label}</Chip>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-x-1 border-t border-hairline pt-3">
            {view.prompt && <CopyButton text={view.prompt.prompt} label="Copy prompt" className="h-11 focus-visible:outline-solid sm:h-9" />}
            {view.script && <CopyButton text={view.script.script} label="Copy script" className="h-11 focus-visible:outline-solid sm:h-9" />}
            {view.receipt && (
              <ReceiptDrawer receipt={view.receipt}>
                <Button variant="link" size="sm" className="ml-3 h-11 px-0 focus-visible:outline-solid text-sm sm:h-9">
                  See the receipts
                </Button>
              </ReceiptDrawer>
            )}
          </div>
          {view.prompt && <p className="text-xs text-ink-soft">The prompt is for {view.prompt.modelName}: one multi-shot clip, {view.prompt.trimTo} s, 9:16.</p>}
        </div>
      </article>
    </ReportSection>
  );
}

function Hook({ view, id }: { view: YourAdView; id: string }) {
  return (
    <>
      <p id={id} className="font-display text-lg leading-snug font-bold text-balance [font-stretch:90%] sm:text-xl">
        {view.hookLine ? <>&ldquo;{view.hookLine}&rdquo;</> : view.conceptTitle}
      </p>
      <p className="text-sm text-ink-soft">
        {view.conceptTitle} · {view.emotion}
      </p>
    </>
  );
}
