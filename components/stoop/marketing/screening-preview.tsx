import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ScreeningPreviewView } from "@/lib/marketing/landing";
import { ScreeningStage } from "./screening-stage";
import { SectionIntro } from "./section-intro";

/** Beats 2 and 3 on the landing: the lead example's Screening Room, with its music style receipt open. */
export function ScreeningPreview({ view }: { view: ScreeningPreviewView }) {
  return (
    <section id="screening" aria-labelledby="screening-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-8 px-5 pb-20">
      <SectionIntro
        id="screening-title"
        kicker={`Screening Room · ${view.brand}`}
        title="Same product. Same video model. Only the brief changed."
        lead="The Control comes from a generic AI brief. Each culture-made ad is one concept world Qloo measured. Tap a cue to see its receipt."
      />
      <ScreeningStage view={view} />
      <Link
        href={`${view.href}#screening`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-base font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick"
      >
        Open the full Screening Room
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
