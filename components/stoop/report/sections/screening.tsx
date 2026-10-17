import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { Button } from "@/components/ui/button";
import type { ReceiptView, ScreeningView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// Stub (report-bottom lane): the Control once, then one tile per measured world, with the skew and
// the setting city opening their receipts. Next: one clip plays at a time, dusk chips per row, the
// theater, and a still (not an empty player) while no clip is approved.
function Fact({ text, receipt }: { text: string; receipt: ReceiptView | null }) {
  if (!receipt) return <span>{text}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <Button variant="link" size="xs" className="h-6 px-0 text-xs">
        {text}
      </Button>
    </ReceiptDrawer>
  );
}

export function ScreeningSection({ view }: { view: ScreeningView }) {
  return (
    <ReportSection id={REPORT_SECTIONS.screening} title="Screening Room" kicker="Data, not stereotypes.">
      <Screen variant="app" className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 sm:p-4 lg:grid-cols-5">
        {view.control && (
          <div className="flex min-w-0 flex-col gap-2">
            <VideoTile label="Control" tone="control" src={view.control.clip?.src} poster={view.control.clip?.poster ?? undefined} />
            <p className="text-xs text-paper-dim">LLM-only brief, not from Qloo. Shown once.</p>
          </div>
        )}
        {view.worlds.map((world) => (
          <div key={world.segmentId} className="flex min-w-0 flex-col gap-1.5">
            <VideoTile label="Culture-made" tone="culture" src={world.clip?.src} poster={world.clip?.poster ?? undefined} />
            <p className="text-xs text-paper">{world.label}</p>
            <div className="flex flex-wrap gap-x-2 text-xs text-paper-dim">
              {world.skewText && <Fact text={world.skewText} receipt={world.skewReceipt} />}
              {world.settingCity && <Fact text={`set in ${world.settingCity}`} receipt={world.settingReceipt} />}
            </div>
          </div>
        ))}
      </Screen>
    </ReportSection>
  );
}
