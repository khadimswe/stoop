import type { KitView } from "@/lib/report/view/types";
import { DownloadButton } from "../kit/download-button";
import { KitWorld } from "../kit/kit-world";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

/**
 * The Campaign Kit: per concept world, the kept concept (Meta and TikTok cuts), the runner-up
 * concepts, captions, the ad plan entry and the creator brief, each card text-first with "Copy
 * script" and a "Prompts" menu. Downloads below. There is no "Send to a creator".
 */
export function KitSection({ view }: { view: KitView }) {
  const { counts, downloads } = view;
  const description =
    counts.concepts > 0
      ? `${counts.concepts} concepts and ${counts.scripts} scripts across ${counts.worlds} concept ${counts.worlds === 1 ? "world" : "worlds"}, each built for a measured audience. Every script speaks as the brand, never as a customer.`
      : undefined;
  return (
    <ReportSection id={REPORT_SECTIONS.kit} title="Campaign Kit" description={description}>
      {view.worlds.length === 0 ? (
        <p className="text-sm text-ink-soft">The Campaign Kit appears once the first concept world is written.</p>
      ) : (
        <div className="flex flex-col gap-8">
          {view.worlds.map((world) => (
            <KitWorld key={world.segmentId} world={world} />
          ))}
        </div>
      )}
      {(downloads.adPlan || downloads.creatorBrief) && (
        <div className="flex flex-col gap-2 rounded-xl bg-fill p-3 sm:flex-row sm:flex-wrap sm:items-center">
          {downloads.adPlan && <DownloadButton file={downloads.adPlan.file} text={downloads.adPlan.text} type="text/csv" label="Meta + TikTok ad plan (CSV)" />}
          {downloads.creatorBrief && <DownloadButton file={downloads.creatorBrief.file} text={downloads.creatorBrief.text} type="text/markdown" label="Creator brief (Markdown)" />}
          <p className="text-xs text-ink-soft sm:ml-1">Targeting suggestions from aggregate taste data. Nothing here auto-publishes.</p>
        </div>
      )}
    </ReportSection>
  );
}
