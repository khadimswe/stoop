import type { DemoFrame } from "@/lib/marketing/demo-timeline";
import type { DemoScript } from "@/lib/marketing/demo-types";
import { BeatTitle, Caret, Kicker, Panel, ReplayButton } from "./parts";

/** Text typed so far, in a box already sized for all of it, so the layout never moves while it types. */
export function TypedText({ text, typed, caret, className }: { text: string; typed: number; caret: boolean; className?: string }) {
  return (
    <span className={`grid ${className ?? ""}`}>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {text}
        <Caret />
      </span>
      <span className="col-start-1 row-start-1">
        {text.slice(0, typed)}
        <Caret show={caret} />
      </span>
    </span>
  );
}

/** Beat 1, /start: "What are you selling?", the product's own description typed out, then "Next". */
export function ComposerBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["composer"] }) {
  const { brandName, description, format, region, descriptionMax } = script.product;
  return (
    <div className="mx-auto flex h-full w-full max-w-[42rem] flex-col justify-center gap-4 @2xl:gap-5">
      <div className="flex flex-col gap-1.5">
        {brandName && <Kicker>{brandName}</Kicker>}
        <BeatTitle>What are you selling?</BeatTitle>
      </div>
      <Panel className="flex flex-col gap-3 p-4 @2xl:p-5">
        <p className="text-[0.8125rem] font-semibold">Describe your product</p>
        <TypedText
          text={description}
          typed={frame.typed}
          caret={!frame.pressed}
          className="rounded-lg border border-paper/15 bg-screen px-3 py-2.5 text-[0.875rem] leading-6 text-paper @2xl:text-base @2xl:leading-7"
        />
        <p className="font-mono text-xs text-paper-dim tabular-nums">
          {frame.typed} of {descriptionMax.toLocaleString("en-US")}
        </p>
        <div className="flex flex-wrap items-center gap-2 border-t border-paper/10 pt-3">
          <span className="inline-flex h-8 items-center rounded-lg bg-paper/[0.07] px-2.5 text-[0.75rem] font-semibold">{format}</span>
          <span className="inline-flex h-8 items-center rounded-lg bg-paper/[0.07] px-2.5 text-[0.75rem] font-semibold">{region}</span>
          <ReplayButton pressed={frame.pressed} className="ml-auto">
            Next
          </ReplayButton>
        </div>
      </Panel>
    </div>
  );
}
