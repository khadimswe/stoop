import { ArrowRight, BadgeCheck, PenLine } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { OutputView } from "@/lib/report/view/types";
import { cn } from "cn";
import { ExportLine } from "../output/export-line";
import { VideoLine } from "../output/video-line";
import { REPORT_SECTIONS, ReportSection } from "../report-section";
import { Storyboard } from "../storyboard";

// The Output section: per world, then the Control, one line each and in this order: Storyboard (the
// concept preview), Video, Export, and "Use Stoop inside your Claude". App register: white cards,
// hairlines, no shadow. The Control is framed in dashed concrete and labeled not from Qloo.

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 first:pt-0 last:pb-0 lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-6">
      <dt className="text-xs font-semibold tracking-wide text-ink-soft uppercase lg:pt-1">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function storyboardLine(view: OutputView): string {
  if (view.storyboard.kind === "frames") return "The concept preview: the storyboard frames from this pack.";
  if (view.isControl) return "The concept preview, shot by shot. Its brief came from an LLM with no Qloo data, so no shot carries a Qloo cue.";
  return "The concept preview, shot by shot, with the Qloo cues each shot carries.";
}

function OutputCard({ view }: { view: OutputView }) {
  const id = `output-${view.key}`;
  return (
    <article
      aria-labelledby={id}
      data-output={view.key}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5",
        view.isControl ? "border-[1.5px] border-dashed border-concrete-line" : "border border-hairline",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={id} className="font-display text-lg leading-snug font-bold [font-stretch:90%]">
          {view.label}
        </h3>
        {view.isControl ? (
          <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
            <PenLine aria-hidden="true" className="size-3" />
            LLM-only brief · not from Qloo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dusk px-2.5 py-0.5 text-xs font-semibold text-dusk">
            <BadgeCheck aria-hidden="true" className="size-3" />
            Culture-made
          </span>
        )}
      </header>
      {view.partial && <p className="text-sm text-ink-soft">Partial: {view.partial.reason}</p>}
      <dl className="flex flex-col divide-y divide-hairline">
        <Row term="Storyboard">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-soft">{storyboardLine(view)}</p>
            <Storyboard view={view.storyboard} cues={view.cues} label={view.label} />
          </div>
        </Row>
        <Row term="Video">
          <VideoLine video={view.video} target={view.target} tone={view.isControl ? "control" : "culture"} />
        </Row>
        <Row term="Export">
          {view.export ? (
            <ExportLine view={view.export} worldLabel={view.label} />
          ) : (
            <p className="text-sm text-ink-soft">The Production Pack appears once this world&apos;s concept is written.</p>
          )}
        </Row>
        <Row term="In your Claude">
          <Link href={view.mcp.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick lg:min-h-0">
            {view.mcp.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Row>
      </dl>
    </article>
  );
}

export function OutputSection({ views }: { views: OutputView[] }) {
  return (
    <ReportSection
      id={REPORT_SECTIONS.output}
      title="Output"
      description="For each concept world and the generic Control: the storyboard, the video, and the Production Pack to render it in your own tool."
    >
      <div className="flex flex-col gap-3">
        {views.map((view) => (
          <OutputCard key={view.key} view={view} />
        ))}
      </div>
    </ReportSection>
  );
}
