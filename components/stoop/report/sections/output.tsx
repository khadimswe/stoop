import { ArrowRight, BadgeCheck, PenLine } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { OutputView } from "@/lib/report/view/types";
import { outputAnchor } from "@/lib/report/view/launch";
import { cn } from "cn";
import { ExportLine } from "../output/export-line";
import { StoryboardLine } from "../output/storyboard-line";
import { VideoLine } from "../output/video-line";
import { REPORT_SECTIONS, ReportSection } from "../report-section";

// The Output section: per world, then the Control, a compact block with one line each, in this order:
// Storyboard (a thumbnail strip or the shot count), Video (what this visitor may render), Export
// (copy the Higgsfield prompt; the Veo scene prompts and the Production Pack open below), and "Use
// Stoop inside your Claude". Every expander reveals the full content in place, so the Screening Room
// (demo beat 2) stays close to the Reality Check. App register: white cards, no shadow. The Control
// is framed in dashed concrete and labeled not from Qloo.

function Line({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 lg:grid lg:grid-cols-[7rem_minmax(0,1fr)] lg:gap-4">
      <dt className="text-xs font-semibold tracking-wide text-ink-soft uppercase lg:flex lg:min-h-9 lg:items-center">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function OutputBlock({ view }: { view: OutputView }) {
  const id = outputAnchor(view.key);
  return (
    <article
      id={id}
      aria-labelledby={`${id}-title`}
      data-output={view.key}
      className={cn(
        "flex scroll-mt-28 flex-col gap-2 rounded-xl bg-surface px-4 py-3 sm:px-5 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start lg:gap-x-6",
        view.isControl ? "border-[1.5px] border-dashed border-concrete-line" : "border border-hairline",
      )}
    >
      {/* Phones and tablets: the name over the lines. Desktop: the name in its own column, so each block stays four lines tall. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-col lg:items-start lg:gap-y-1.5 lg:pt-1.5">
        <h3 id={`${id}-title`} className="font-display text-base leading-snug font-bold text-balance [font-stretch:90%] sm:text-lg">
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
        {view.partial && <p className="text-sm text-ink-soft">Partial: {view.partial.reason}</p>}
      </header>
      <dl className="flex min-w-0 flex-col gap-2 lg:gap-1">
        <Line term="Storyboard">
          <StoryboardLine view={view.storyboard} cues={view.cues} label={view.label} isControl={view.isControl} />
        </Line>
        <Line term="Video">
          <VideoLine video={view.video} target={view.target} tone={view.isControl ? "control" : "culture"} />
        </Line>
        <Line term="Export">
          {view.export ? (
            <ExportLine view={view.export} worldLabel={view.label} />
          ) : (
            <p className="flex min-h-11 items-center text-sm text-ink-soft sm:min-h-9">The Production Pack appears once this world&apos;s concept is written.</p>
          )}
        </Line>
        <Line term="In your Claude">
          <Link href={view.mcp.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick sm:min-h-9">
            {view.mcp.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Line>
      </dl>
    </article>
  );
}

export function OutputSection({ views }: { views: OutputView[] }) {
  return (
    <ReportSection id={REPORT_SECTIONS.output} title="Output" description="Each concept world and the generic Control: storyboard, video, and the prompts for your own video tool.">
      <div className="flex flex-col gap-2">
        {views.map((view) => (
          <OutputBlock key={view.key} view={view} />
        ))}
      </div>
    </ReportSection>
  );
}
