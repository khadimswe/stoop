import Image from "next/image";
import { Flag } from "lucide-react";
import { Chip } from "@/components/stoop/chip";
import { cn } from "cn";
import type { DemoFrame } from "@/lib/marketing/demo-timeline";
import type { DemoRealityLine, DemoScript, DemoWorld } from "@/lib/marketing/demo-types";
import { BeatTitle, Kicker, Panel, RISE, SourceTag } from "./parts";

const TAG: Record<NonNullable<DemoRealityLine["source"]>, { tone: "qloo" | "you" | "concrete"; label: string }> = {
  you: { tone: "you", label: "You" },
  qloo: { tone: "qloo", label: "Qloo" },
  generic: { tone: "concrete", label: "Generic AI brief · not from Qloo" },
  site: { tone: "concrete", label: "Read from your site · not from Qloo" },
};

function RealityLine({ line }: { line: DemoRealityLine }) {
  const tag = line.source ? TAG[line.source] : null;
  if (line.kind === "measured")
    return (
      <p className={cn("font-display text-[1.375rem] leading-[1.12] font-extrabold tracking-tight text-pretty [font-stretch:85%] @2xl:text-[1.75rem] @4xl:text-[2rem]", RISE)}>
        {line.text} {tag && <SourceTag tone={tag.tone} className="ml-1 translate-y-[-0.2em] align-middle font-sans tracking-normal">{tag.label}</SourceTag>}
      </p>
    );
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-pretty",
        line.source === "generic" || line.source === "site" ? "text-sm text-concrete-screen @2xl:text-base" : line.source === null ? "text-sm text-paper-dim" : "text-base font-semibold @2xl:text-lg",
        RISE,
      )}
    >
      <span>{line.text}</span>
      {tag && <SourceTag tone={tag.tone}>{tag.label}</SourceTag>}
    </p>
  );
}

/** Beat 4, the report: the Reality Check, line by line, exactly as the gap stage wrote it. */
export function RealityBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["reality"] }) {
  const { reality, product } = script;
  return (
    <div className="mx-auto flex h-full w-full max-w-[56rem] flex-col justify-center gap-4 @2xl:gap-5">
      <Kicker>Reality Check{product.brandName && ` · ${product.brandName}`}</Kicker>
      {reality.lines.slice(0, frame.lines).map((line, i) => (
        <RealityLine key={`${i}-${line.kind}`} line={line} />
      ))}
      <div className={cn("flex flex-col gap-1.5 border-t border-paper/10 pt-3 transition-opacity duration-500", frame.receipt ? "opacity-100" : "opacity-0")}>
        {reality.receipt && <p className="font-mono text-xs text-paper-dim">{reality.receipt}</p>}
        <p className="text-xs text-paper-dim">Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.</p>
      </div>
    </div>
  );
}

function WorldCard({ world }: { world: DemoWorld }) {
  const meta = [world.skew, world.setting && `set in ${world.setting}`].filter(Boolean).join(" · ");
  return (
    <Panel className={cn("flex min-w-0 flex-col gap-1.5 p-3 @2xl:gap-2 @2xl:p-4", RISE)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Kicker className="hidden @2xl:block">World {world.position}</Kicker>
          <p className="text-[0.875rem] leading-snug font-semibold @2xl:text-[0.9375rem]">{world.label}</p>
        </div>
        <SourceTag tone="qloo">Qloo</SourceTag>
      </div>
      {meta && <p className="font-mono text-[0.6875rem] leading-4 text-paper-dim">{meta}</p>}
      <div className="mt-0.5 flex flex-col gap-1 border-t border-paper/10 pt-2 @2xl:gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-display text-[0.9375rem] leading-tight font-bold [font-stretch:90%] @2xl:text-base">{world.conceptTitle}</p>
          <Chip origin="creative" surface="screen" showOrigin className="hidden px-2 py-0.5 text-[0.6875rem] @4xl:inline-flex">
            Concept
          </Chip>
        </div>
        <p className="line-clamp-2 text-[0.8125rem] leading-[1.2rem] @2xl:line-clamp-5">{world.hook}</p>
      </div>
    </Panel>
  );
}

/** Beat 5: the concept worlds with their hooks, next to the Control (the generic AI brief, in gray). */
export function WorldsBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["worlds"] }) {
  const { worlds, control } = script;
  const showControl = frame.cards > worlds.length;
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-3 @2xl:gap-4">
      <div className="flex flex-col gap-1">
        <Kicker className="hidden @2xl:block">Concept worlds</Kicker>
        <BeatTitle>
          {worlds.length} concept {worlds.length === 1 ? "world" : "worlds"}, and the Control
        </BeatTitle>
      </div>
      <div className={cn("grid min-h-0 content-start gap-2 @2xl:gap-3", worlds.length === 2 ? "@2xl:grid-cols-3" : "@2xl:grid-cols-2 @4xl:grid-cols-4")}>
        {worlds.slice(0, frame.cards).map((world) => (
          <WorldCard key={world.segmentId} world={world} />
        ))}
        {showControl && (
          <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border-[1.5px] border-dashed border-concrete-screen p-3 @2xl:gap-2 @2xl:p-4", RISE)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Kicker className="text-concrete-screen">Control</Kicker>
              <SourceTag tone="concrete">Generic AI brief · not from Qloo</SourceTag>
            </div>
            {control.conceptTitle && <p className="font-display text-[0.9375rem] leading-tight font-bold text-concrete-screen [font-stretch:90%] @2xl:text-base">{control.conceptTitle}</p>}
            {control.hook && <p className="line-clamp-2 text-[0.8125rem] leading-[1.2rem] text-concrete-screen @2xl:line-clamp-4">{control.hook}</p>}
            {control.headline && (
              <p className={cn("mt-auto flex items-start gap-1.5 border-t border-paper/10 pt-2 text-[0.8125rem] leading-[1.2rem] font-semibold text-rose-light transition-opacity duration-500", frame.headline ? "opacity-100" : "opacity-0")}>
                <Flag aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <span className="sr-only">Flagged: </span>
                  {control.headline}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Beat 6: the top world's concept preview. Approved frames when the manifest has them, else its shot list. */
export function StoryboardBeat({ script, frame }: { script: DemoScript; frame: DemoFrame["storyboard"] }) {
  const board = script.storyboard;
  if (!board) return null;
  const { view } = board;
  return (
    <div className="flex h-full min-h-0 flex-col justify-center gap-3 @2xl:gap-4">
      <div className="flex flex-col gap-1">
        <Kicker className="hidden @2xl:block">Storyboard · concept preview</Kicker>
        <BeatTitle>{board.conceptTitle}</BeatTitle>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-[0.8125rem] text-paper-dim">{board.world}</p>
          {view.kind === "shots" && (
            <p className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-paper-dim">
              Brief cues per shot:
              <Chip origin="interpreted" surface="screen" className="px-1.5 py-0.5 text-[0.625rem] [&_svg]:size-2.5">
                From Qloo
              </Chip>
              <Chip origin="creative" surface="screen" className="px-1.5 py-0.5 text-[0.625rem] [&_svg]:size-2.5">
                Not from Qloo
              </Chip>
            </p>
          )}
        </div>
      </div>
      {view.kind === "frames" ? (
        <ol className="grid min-h-0 flex-1 grid-cols-2 gap-2 @4xl:grid-cols-4 @2xl:gap-3">
          {view.frames.slice(0, frame.shots).map((f) => (
            <li key={f.scene} className={cn("relative min-h-0 overflow-hidden rounded-xl bg-screen-raised", RISE)}>
              <Image src={f.src} alt={f.alt} width={360} height={640} unoptimized className="size-full object-cover" />
              <p className="absolute inset-x-0 bottom-0 bg-screen/80 px-2 py-1 font-mono text-[0.6875rem] text-paper-dim">Shot {f.scene + 1}</p>
            </li>
          ))}
        </ol>
      ) : (
        <ol className={cn("grid min-h-0 content-start gap-1.5 @2xl:gap-3", view.shots.length > 4 ? "@2xl:grid-cols-3 @4xl:grid-cols-5" : "@2xl:grid-cols-2 @4xl:grid-cols-4")}>
          {view.shots.slice(0, frame.shots).map((shot) => (
            <li key={shot.scene} className={cn("min-w-0", RISE)}>
              <Panel className="flex h-full flex-col gap-1 px-3 py-1.5 @2xl:gap-1.5 @2xl:py-3">
                <p className="flex flex-wrap justify-between gap-x-2 font-mono text-[0.6875rem] leading-4 text-paper-dim">
                  <span>
                    Shot {shot.number} · {shot.beat}
                  </span>
                  <span>
                    {shot.start} to {shot.end} s
                  </span>
                </p>
                <p className="line-clamp-1 text-[0.8125rem] leading-[1.2rem] @2xl:line-clamp-4 @4xl:line-clamp-5">{shot.action}</p>
                {shot.overlayText && (
                  <p className="hidden text-xs leading-4 text-paper-dim @2xl:block">
                    On screen: <span className="text-paper">{shot.overlayText}</span>
                  </p>
                )}
                {shot.carries.length > 0 && (
                  <ul aria-label="Brief cues this shot carries" className="mt-auto flex flex-nowrap gap-1 overflow-hidden pt-1 @2xl:flex-wrap">
                    {shot.carries.map((cue) => (
                      // Phones keep one line: the cues Qloo backs. Wider screens add the creative ones.
                      <li key={cue.label} className={cn("shrink-0", cue.origin !== "qloo" && cue.origin !== "interpreted" && "hidden @2xl:block")}>
                        <Chip origin={cue.origin} surface="screen" className="px-1.5 py-0.5 text-[0.625rem] [&_svg]:hidden @2xl:[&_svg]:block @2xl:[&_svg]:size-2.5">
                          {cue.label}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
