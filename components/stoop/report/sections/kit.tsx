import { Chip } from "@/components/stoop/chip";
import { CopyButton } from "@/components/stoop/copy-button";
import type { KitView } from "@/lib/report/view/types";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// Stub (report-bottom lane): one group per world with its hook, what it tests and its scripts. Next:
// kit cards, the "Prompts" menu and the downloads.
export function KitSection({ view }: { view: KitView }) {
  return (
    <ReportSection id={REPORT_SECTIONS.kit} title="Campaign Kit">
      <div className="grid gap-3 md:grid-cols-2">
        {view.worlds.map((world) => (
          <article key={world.segmentId} aria-labelledby={`kit-${world.segmentId}`} className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface p-4">
            <h3 id={`kit-${world.segmentId}`} className="text-sm font-semibold text-ink-soft">
              {world.label}
            </h3>
            {world.hook && (
              <>
                <Chip origin="creative" showOrigin className="self-start">
                  Concept
                </Chip>
                <p className="font-display text-lg leading-snug font-bold [font-stretch:90%]">{world.hook}</p>
              </>
            )}
            {world.testHypothesis && <p className="text-sm text-ink-soft">What this tests: {world.testHypothesis}</p>}
            <ul className="flex flex-col gap-1">
              {world.scripts.map((script) => (
                <li key={`${script.format}-${script.platform}-${script.tool}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {script.formatLabel} · {script.platform === "meta" ? "Meta" : "TikTok"} · {script.tool === "creator" ? "creator" : script.tool === "arcads" ? "Arcads" : "Creatify"}
                  </span>
                  <CopyButton text={script.script} label="Copy script" />
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </ReportSection>
  );
}
