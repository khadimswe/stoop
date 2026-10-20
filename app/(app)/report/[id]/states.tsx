import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";

// The live report's non-report states: loading, a run still going, a run that stopped, a run that
// failed before it measured anything, and a report that cannot be loaded. Each has the page's h1 and
// a way to an example, so the page is never blank. App register: white card, hairline, one primary.

export const EXAMPLE_HREF = `/examples/${LEAD_EXAMPLE.slug}`;

/** What each run stage is doing, in plain words (the progress line). */
export const STAGE_WORDS: Readonly<Record<string, string>> = {
  prove: "Mapping the taste neighborhood",
  gap: "Running the Reality Check",
  segments: "Finding the concept worlds",
  culture: "Writing the Culture Briefs",
  concepts: "Writing the concepts",
  prompts: "Writing the Production Pack",
  score: "Scoring the generic brief",
};

export function StateShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pt-6 pb-20 sm:px-5 sm:pt-8">
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%]">Your report</h1>
      {children}
    </div>
  );
}

export function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <h2 className="font-display text-xl leading-snug font-bold [font-stretch:90%]">{title}</h2>
      {children}
    </section>
  );
}

export function ExampleLink({ primary = false }: { primary?: boolean }) {
  if (primary) {
    return (
      <Button asChild>
        <Link href={EXAMPLE_HREF}>See an example report</Link>
      </Button>
    );
  }
  return (
    <Link href={EXAMPLE_HREF} className="text-sm font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick">
      See an example report
    </Link>
  );
}

/** The shape of the report that is coming: the header, the Reality Check and a card, as skeletons. */
export function ReportSkeleton() {
  return (
    <StateShell>
      <p role="status" className="text-sm text-ink-soft">
        Loading your report.
      </p>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <span className="h-5 w-48 rounded-full bg-fill motion-safe:animate-pulse" />
        <span className="h-28 w-full rounded-xl bg-fill motion-safe:animate-pulse" />
        <span className="h-56 w-full rounded-xl bg-fill motion-safe:animate-pulse" />
      </div>
    </StateShell>
  );
}
