import type { ReplayView } from "@/lib/marketing/landing";
import { TraceReplay } from "./trace-replay";

/** "How it works", shown as a replay of the lead example's recorded trace, on the one sand field. */
export function HowItWorks({ replay }: { replay: ReplayView }) {
  return (
    <section id="how" aria-labelledby="how-title" className="mx-3 scroll-mt-24 rounded-section bg-sand py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-x-14 gap-y-10 px-5">
        <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-4 lg:sticky lg:top-28">
          <p className="type-kicker text-ink-soft">How it works</p>
          <h2 id="how-title" className="type-h2 text-balance">
            Watch the agent build this.
          </h2>
          <p className="type-lead text-pretty text-ink-soft">
            Qloo maps the audience around your product&apos;s taste neighborhood: who it is, what else they love, where they cluster. Then Stoop
            writes a Culture Brief and a Production Pack for each concept world.
          </p>
          <p className="font-display text-[1.5rem] leading-tight font-bold text-balance [font-stretch:90%]">Stoop is the brain, you bring your own camera.</p>
          <p className="text-sm text-ink-soft">This is {replay.brand}&apos;s recorded run, step by step: the Qloo calls it made and the decisions the agent took, with their reasons.</p>
        </div>
        <div className="min-w-0 flex-[1_1_32rem]">
          <TraceReplay view={replay} />
        </div>
      </div>
    </section>
  );
}
