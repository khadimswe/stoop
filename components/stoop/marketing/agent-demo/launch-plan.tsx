import { Chip } from "@/components/stoop/chip";
import { cn } from "cn";
import type { DemoLaunchCell, DemoLaunchPlan } from "@/lib/marketing/demo-types";
import { BeatTitle, Kicker, RISE, SourceTag } from "./parts";

function Cell({ cell }: { cell: DemoLaunchCell }) {
  const control = cell.kind === "control";
  return (
    <li className={cn("min-w-0", RISE)}>
      <div className={cn("flex h-full flex-col gap-1.5 rounded-xl p-3 @2xl:gap-2 @2xl:p-4", control ? "border-[1.5px] border-dashed border-concrete-screen" : "border border-paper/10 bg-screen-raised")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Kicker className={cn(control && "text-concrete-screen")}>{control ? "Control" : cell.name}</Kicker>
          {control ? <SourceTag tone="concrete">{cell.label}</SourceTag> : <SourceTag tone="qloo">Qloo</SourceTag>}
        </div>
        {!control && <p className="text-[0.875rem] leading-snug font-semibold">{cell.label}</p>}
        <Chip origin="creative" surface="screen" className="self-start px-2 py-0.5 text-[0.6875rem]">
          {cell.conceptTitle}
        </Chip>
        {control && <p className="hidden text-[0.8125rem] leading-[1.2rem] text-concrete-screen @2xl:block">{cell.watch}</p>}
        {cell.interests.length > 0 && (
          <div className="mt-auto flex flex-col gap-1 border-t border-paper/10 pt-2">
            <p className="text-[0.6875rem] text-paper-dim">Interest searches to try</p>
            {/* Phones show the first two; wider screens all of them. */}
            <ul aria-label="Interest searches" className="flex flex-wrap gap-1">
              {cell.interests.map((interest, i) => (
                <li key={interest.name} className={cn("max-w-full", i >= 2 && "hidden @2xl:block")}>
                  <Chip origin="qloo" surface="screen" className="gap-1 px-1.5 py-0.5 text-[0.625rem] [&_svg]:size-2.5">
                    {interest.name}
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Beat 7: the report's Launch plan, in brief. The Control (the generic AI brief) is the baseline cell,
 * then one cell per concept world with its first interest searches from Qloo. The budget helper stays
 * in the report. `cells`: how many cells are showing; omit it to show them all.
 */
export function LaunchPlanBeat({ plan, cells }: { plan: DemoLaunchPlan; cells?: number }) {
  const shown = plan.cells.slice(0, cells ?? plan.cells.length);
  return (
    <div className="mx-auto flex h-full w-full flex-col justify-center gap-3 pb-16 @2xl:gap-4 @2xl:pb-20">
      <div className="flex flex-col gap-1">
        <Kicker>Launch plan</Kicker>
        <BeatTitle>{plan.campaign}</BeatTitle>
        {plan.unavailable && <p className="text-[0.8125rem] text-paper-dim">{plan.unavailable}</p>}
      </div>
      {shown.length > 0 && (
        <ol className={cn("grid grid-cols-[minmax(0,1fr)] content-start gap-2 @2xl:gap-3", plan.cells.length === 3 ? "@2xl:grid-cols-3" : "@2xl:grid-cols-2 @4xl:grid-cols-4")}>
          {shown.map((cell) => (
            <Cell key={cell.key} cell={cell} />
          ))}
        </ol>
      )}
    </div>
  );
}
