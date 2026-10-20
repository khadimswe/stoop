import type { ReplayView } from "@/lib/marketing/landing";
import { TraceReplay } from "./trace-replay";

/**
 * "Watch the agent build this": the lead example's recorded trace, step by step, next to the line
 * that says what Stoop is and is not. The replay's moving highlight is this section's one motion.
 */
export function AgentTrace({ replay }: { replay: ReplayView }) {
  return (
    <section id="trace" aria-labelledby="trace-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-wrap items-start gap-x-14 gap-y-10 px-5 py-20">
      <div className="flex min-w-0 flex-[1_1_22rem] flex-col gap-4 lg:sticky lg:top-28">
        <p className="type-kicker text-ink-soft">The recorded trace</p>
        <h2 id="trace-title" className="type-h2 text-balance">
          Watch the agent build this.
        </h2>
        <p className="type-lead text-pretty text-ink-soft">
          {replay.brand}&apos;s recorded run, step by step: the Qloo calls it made and the decisions the agent took, with their reasons. Then Stoop
          writes a Culture Brief and a Production Pack for each concept world.
        </p>
        <p className="font-display text-[1.5rem] leading-tight font-bold text-balance [font-stretch:90%]">Stoop is the brain, you bring your own camera.</p>
      </div>
      <div className="min-w-0 flex-[1_1_32rem]">
        <TraceReplay view={replay} />
      </div>
    </section>
  );
}
