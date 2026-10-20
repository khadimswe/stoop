import { SeedChip } from "@/components/stoop/chip";
import { cn } from "cn";
import type { DemoFrame } from "@/lib/marketing/demo-timeline";
import type { DemoScript } from "@/lib/marketing/demo-types";
import { TypedText } from "./composer-beat";
import { BeatTitle, Panel, ReplayButton, RISE } from "./parts";

/** Beat 2, /start step 2: "Here's what we found.", the seeds one by one with their origins, the founder's guess, "Map my audience". */
export function SeedsBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["seeds"] }) {
  const { product, seeds, statedCustomer } = script;
  const facts = [
    { label: "Product", value: product.name },
    product.brandName ? { label: "Brand", value: product.brandName } : null,
    product.price ? { label: "Price", value: product.price } : null,
    { label: "Region", value: product.region },
  ].filter((fact) => fact !== null);
  return (
    <div className="mx-auto flex h-full w-full max-w-[56rem] flex-col justify-center gap-3 @2xl:gap-4">
      <div className="flex flex-col gap-1">
        <BeatTitle>Here&apos;s what we found.</BeatTitle>
        <p className="font-mono text-xs text-paper-dim @2xl:hidden">{facts.map((fact) => fact.value).join(" · ")}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Panel className="hidden flex-col gap-2.5 p-4 @2xl:flex">
          <p className="text-sm font-bold">From your description</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[0.8125rem]">
            {facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-paper-dim">{fact.label}</dt>
                <dd className="min-w-0 truncate">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel className="flex flex-col gap-2.5 p-3.5 @2xl:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-bold">Your audience probably also loves these</p>
            <p className="font-mono text-xs text-paper-dim tabular-nums">
              {frame.chips} {frame.chips === 1 ? "seed" : "seeds"} · {seeds.range.min} to {seeds.range.max}
            </p>
          </div>
          {/* Space for every chip from the start, so the card never grows as they land. */}
          <ul className="grid grid-cols-[minmax(0,1fr)]">
            <li aria-hidden="true" className="invisible col-start-1 row-start-1 flex min-w-0 flex-wrap gap-1.5 @2xl:gap-2">
              {seeds.items.map((seed) => (
                <SeedChip key={seed.id} surface="screen" origin={seed.origin} name={seed.name} kind={seed.kind} className="h-7 text-xs @2xl:h-8 @2xl:text-[0.8125rem]" />
              ))}
            </li>
            <li className="col-start-1 row-start-1 flex min-w-0 flex-wrap content-start gap-1.5 @2xl:gap-2">
              {seeds.items.slice(0, frame.chips).map((seed) => (
                <SeedChip key={seed.id} surface="screen" origin={seed.origin} name={seed.name} kind={seed.kind} className={cn("h-7 text-xs @2xl:h-8 @2xl:text-[0.8125rem]", RISE)} />
              ))}
            </li>
          </ul>
        </Panel>
      </div>
      {statedCustomer && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[0.8125rem] font-semibold">Who do you think buys it?</p>
          <TypedText
            text={statedCustomer}
            typed={frame.typed}
            caret={frame.chips === seeds.items.length && !frame.pressed}
            className="rounded-lg border border-paper/15 bg-screen-raised px-3 py-2 text-[0.875rem] leading-6"
          />
        </div>
      )}
      <ReplayButton pressed={frame.pressed} className="self-start">
        Map my audience
      </ReplayButton>
    </div>
  );
}
