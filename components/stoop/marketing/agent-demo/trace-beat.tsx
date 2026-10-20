import { Check, Database, Signpost } from "lucide-react";
import { cn } from "cn";
import type { DemoFrame } from "@/lib/marketing/demo-timeline";
import type { DemoScript, DemoStep } from "@/lib/marketing/demo-types";
import type { RailStatus } from "@/lib/run/rail";
import { BeatTitle, Kicker, Panel } from "./parts";

/** How many of the newest steps the log keeps on screen; older ones scroll off the top. */
const WINDOW = 9;

function StatusIcon({ status, className }: { status: RailStatus; className?: string }) {
  if (status === "done")
    return (
      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full bg-paper", className)}>
        <Check className="size-2.5 text-screen" strokeWidth={3.4} />
      </span>
    );
  if (status === "current")
    return (
      <span className={cn("relative flex size-4 shrink-0 items-center justify-center", className)}>
        <span className="absolute inset-0.5 rounded-full border-2 border-dusk-light border-r-transparent motion-safe:animate-spin" />
        <span className="size-1.5 rounded-full bg-dusk-light motion-safe:hidden" />
      </span>
    );
  return <span className={cn("m-0.5 size-3 shrink-0 rounded-full border-[1.5px] border-paper/30", className)} />;
}

/** Qloo calls per rail stage among the steps shown so far: the same tally the rail's counts come from. */
function stageCalls(script: DemoScript, steps: readonly DemoStep[]): number[] {
  return script.trace.stages.map(({ label }) => steps.filter((step) => step.kind === "tool" && step.stageLabel === label).length);
}

function Row({ step, heading }: { step: DemoStep; heading: boolean }) {
  const decision = step.kind === "decision";
  const Icon = decision ? Signpost : Database;
  return (
    <li className="grid motion-safe:animate-row-in">
      <div className="min-h-0 overflow-hidden">
        {heading && <p className="pt-2.5 font-mono text-[0.625rem] leading-4 font-medium tracking-[0.1em] text-paper-dim uppercase">{step.stageLabel}</p>}
        <div className="flex gap-2.5 border-b border-paper/[0.07] py-2">
          <Icon className={cn("mt-0.5 size-3.5 shrink-0", decision ? "text-paper" : "text-dusk-light")} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className={cn("text-[0.8125rem] leading-[1.15rem] text-pretty", decision && "font-semibold")}>{step.label}</p>
            {(step.world || step.served) && (
              <p className="flex flex-wrap gap-x-2 font-mono text-[0.6875rem] leading-4 text-paper-dim">
                {step.world && <span>{step.world}</span>}
                {step.served && <span>{step.served === "cached" ? "from cache" : "live call"}</span>}
              </p>
            )}
            {step.reason && <p className="line-clamp-2 text-xs leading-4 text-paper-dim">{step.reason}</p>}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Beat 3, /run: the recorded trace streaming in at its own (compressed) pace, the rail moving stage to
 * stage, and the Qloo calls rising to the run's real count, cached ones counted separately.
 */
export function TraceBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["trace"] }) {
  const { trace, product } = script;
  const shown = trace.steps.slice(0, frame.steps);
  const last = shown.at(-1);
  const rail = frame.done ? trace.finalRail : (last?.rail ?? trace.initialRail);
  const calls = frame.done ? trace.totals : (last?.calls ?? { live: 0, cached: 0 });
  const perStage = frame.done ? trace.finalStageCalls : stageCalls(script, shown);
  const from = Math.max(0, shown.length - WINDOW);
  const current = trace.stages.filter((_, i) => rail[i] === "current").map((s) => s.label);
  const doneCount = rail.filter((status) => status === "done").length;
  const total = calls.live + calls.cached;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 @2xl:grid @2xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @2xl:gap-5 @4xl:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] @4xl:gap-6">
      <div className="flex flex-col gap-3 @2xl:gap-4">
        <div className="flex flex-col gap-1">
          <Kicker>Agent at work</Kicker>
          <BeatTitle className="text-[1.125rem] @2xl:text-[1.375rem] @4xl:text-[1.5rem]">Mapping the taste neighborhood around {product.name}</BeatTitle>
        </div>

        {/* Phones: the rail as a row of marks with the stage in progress named under it. */}
        <div className="flex flex-col gap-1.5 @2xl:hidden">
          <div className="flex items-center gap-1.5">
            {trace.stages.map((stage, i) => (
              <StatusIcon key={stage.stage} status={rail[i]} />
            ))}
          </div>
          <p className="truncate text-xs text-paper-dim">
            {frame.done ? "Every stage done" : current.length ? current.join(" + ") : "Starting"} · {doneCount} of {trace.stages.length} done
          </p>
        </div>

        {/* Wider screens: the rail as a list, each stage with the Qloo calls its steps made. */}
        <Panel className="hidden p-1.5 @2xl:block">
          <ol className="flex flex-col">
            {trace.stages.map((stage, i) => (
              <li key={stage.stage} className={cn("flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 py-1", rail[i] === "current" && "bg-paper/[0.07]")}>
                <StatusIcon status={rail[i]} />
                <span className={cn("flex-1 text-[0.8125rem]", rail[i] === "pending" ? "text-paper-dim" : "text-paper", rail[i] === "current" && "font-semibold")}>{stage.label}</span>
                <span className="font-mono text-[0.6875rem] text-paper-dim tabular-nums">{perStage[i] > 0 ? perStage[i] : ""}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="flex items-end gap-3 @2xl:flex-col @2xl:items-start @2xl:gap-1">
          <p className="flex items-baseline gap-2">
            <span key={total} className="font-mono text-[1.75rem] leading-none font-semibold text-paper tabular-nums motion-safe:animate-rise @4xl:text-[2.25rem]">
              {total}
            </span>
            <span className="text-sm text-paper">Qloo calls</span>
          </p>
          <p className="pb-0.5 font-mono text-xs text-paper-dim tabular-nums @2xl:pb-0">
            {calls.cached} from cache · {calls.live} live
          </p>
        </div>
      </div>

      <Panel className="relative flex min-h-0 flex-1 flex-col px-3.5 pb-1 @2xl:px-4">
        <div className="flex items-center justify-between border-b border-paper/10 py-2.5">
          <Kicker>Trace</Kicker>
          <p className="font-mono text-[0.6875rem] text-paper-dim tabular-nums">
            {shown.length} of {trace.steps.length} steps
          </p>
        </div>
        {/* Anchored to the bottom: new steps land there and older ones slide off the top, under a fade. */}
        <ol className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_3.5rem)]">
          {shown.slice(from).map((step, i) => (
            <Row key={from + i} step={step} heading={step.startsGroup || i === 0} />
          ))}
        </ol>
      </Panel>
    </div>
  );
}
