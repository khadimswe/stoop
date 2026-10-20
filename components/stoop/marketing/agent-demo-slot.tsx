import { Check, History } from "lucide-react";
import type { ReactNode } from "react";
import { Screen } from "@/components/stoop/screen";
import type { AgentDemoStillView } from "@/lib/marketing/landing";
import { cn } from "cn";
import { SourceTag } from "./source-tag";

/**
 * The lead run in one frame, until the recorded-run player takes the slot: its five steps with their
 * real Qloo call counts, the Reality Check line it ended on, and the total. Labeled as a replay of a
 * recorded run, so it never reads as a live agent or as an empty player.
 */
export function AgentDemoStill({ view }: { view: AgentDemoStillView }) {
  return (
    <div className="flex h-full min-h-0 flex-col justify-between gap-4 p-5 sm:p-7 lg:p-9">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-paper/30 px-3 py-1 font-mono text-[0.6875rem] tracking-widest text-paper uppercase">
          <History aria-hidden="true" className="size-3.5" />
          Replay of a recorded run
        </p>
        <p className="font-mono text-xs text-paper-dim">
          {view.brand} · recorded {view.date}
        </p>
      </div>

      <ol aria-label="Steps in the recorded run" className="hidden flex-wrap gap-x-5 gap-y-2 md:flex">
        {view.steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-sm text-paper">
            <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full bg-paper text-screen">
              <Check className="size-3" strokeWidth={3} />
            </span>
            {step.title}
            <span className="font-mono text-[0.6875rem] text-paper-dim">{step.calls > 0 ? `${step.calls} calls` : "no calls"}</span>
          </li>
        ))}
      </ol>

      {view.measured && (
        <div className="flex min-h-0 flex-col items-start gap-3">
          <p className="font-mono text-[0.6875rem] tracking-widest text-paper-dim uppercase">Where the run landed</p>
          <p className="max-w-[30ch] font-display text-[1.375rem] leading-[1.08] font-extrabold text-pretty [font-stretch:80%] sm:text-[2rem] lg:text-[2.75rem]">
            {view.measured}
          </p>
          <SourceTag source="qloo" surface="screen" />
        </div>
      )}

      <p className="border-t border-paper/15 pt-3 font-mono text-xs text-paper-dim">
        {view.calls} Qloo calls, {view.cached === view.calls ? "all replayed from the recording" : `${view.cached} from cache`} · zero live calls
      </p>
    </div>
  );
}

/**
 * Right under the hero: a dark screen with a fixed aspect ratio, reserved for the replay of a recorded
 * run, so whatever plays in it never shifts the page. `children` is the player; without one the slot
 * shows `still`. `className` sizes or restyles the screen (its aspect ratio lives here).
 */
export function AgentDemoSlot({ still, children, className }: { still: AgentDemoStillView; children?: ReactNode; className?: string }) {
  return (
    <section id="agent-demo" aria-labelledby="agent-demo-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-4 px-5 pb-20">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="agent-demo-title" className="type-kicker text-ink-soft">
          The agent at work · {still.brand}
        </h2>
        <p className="text-sm text-ink-soft">A recorded run on real Qloo responses. Nothing here calls Qloo again.</p>
      </div>
      <Screen data-slot="agent-demo" className={cn("relative aspect-[4/5] w-full overflow-hidden sm:aspect-[4/3] md:aspect-[16/10] lg:aspect-video", className)}>
        {children ?? <AgentDemoStill view={still} />}
      </Screen>
    </section>
  );
}
