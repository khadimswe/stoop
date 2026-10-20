import { cn } from "cn";
import type { DemoLaunchPlan } from "@/lib/marketing/demo-types";
import { BeatTitle, Kicker, Panel, RISE, SourceTag } from "./parts";

/**
 * The demo's last beat until the real Launch plan lands: one test cell per concept world (its kit's ad
 * plan entry), with the Control as the baseline. AgentDemo's `launchPlan` prop replaces it.
 * `rows`: how many rows are showing (the cells first, then the baseline); omit it to show them all.
 */
export function LaunchPlanPlaceholder({ plan, rows }: { plan: DemoLaunchPlan; rows?: number }) {
  const shown = rows ?? plan.cells.length + 1;
  return (
    <div className="mx-auto flex h-full w-full max-w-[56rem] flex-col justify-center gap-3 pb-16 @2xl:gap-4 @2xl:pb-20">
      <div className="flex flex-col gap-1">
        <Kicker>Launch plan</Kicker>
        <BeatTitle>
          {plan.cells.length} test {plan.cells.length === 1 ? "cell" : "cells"}, one per concept world
        </BeatTitle>
        <p className="text-[0.8125rem] text-paper-dim">From each world&apos;s ad plan, with the Control as the baseline.</p>
      </div>
      <ol className="flex flex-col gap-2">
        {plan.cells.slice(0, shown).map((cell, i) => (
          <li key={cell.segmentId} className={RISE}>
            <Panel className="flex flex-col gap-1 px-3.5 py-2.5 @2xl:px-4 @2xl:py-3">
              <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <span className="font-mono text-[0.6875rem] text-paper-dim">Cell {i + 1}</span>
                <span className="text-[0.875rem] leading-snug font-semibold">{cell.name}</span>
              </p>
              <p className="line-clamp-2 text-[0.8125rem] leading-[1.2rem] text-paper-dim">{cell.watch}</p>
            </Panel>
          </li>
        ))}
        {shown > plan.cells.length && (
          <li className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border-[1.5px] border-dashed border-concrete-screen px-3.5 py-2.5 @2xl:px-4", RISE)}>
            <span className="font-mono text-[0.6875rem] text-concrete-screen">Baseline</span>
            <span className="text-[0.875rem] font-semibold text-concrete-screen">{plan.baseline}</span>
            <SourceTag tone="concrete">Generic AI brief · not from Qloo</SourceTag>
          </li>
        )}
      </ol>
    </div>
  );
}
