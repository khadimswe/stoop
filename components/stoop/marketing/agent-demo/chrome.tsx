import { cn } from "cn";
import { DEMO_BEATS } from "@/lib/marketing/demo-types";
import { BAR_BOX, STAGE_BOX } from "./parts";

// The screen's frame around the replay: the fixed label on top and the control bar's shape. Shared by
// the player and the placeholder that holds its place while it loads, so nothing moves when it mounts.

/** The fixed top line: what this is (a replay of a recorded run) and, while playing, where in the product it is. */
export function TopBar({ label, route, live = false }: { label: string; route?: string; live?: boolean }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-paper/10 px-4 py-2 @2xl:px-5">
      <span aria-hidden="true" className="relative flex size-2 shrink-0">
        {live && <span className="absolute inset-0 rounded-full bg-dusk-light opacity-60 motion-safe:animate-ping" />}
        <span className="relative size-2 rounded-full bg-dusk-light" />
      </span>
      <p className="min-w-0 flex-1 font-mono text-[0.6875rem] leading-4 text-paper-dim @md:text-xs">{label}</p>
      {route && <span className="hidden shrink-0 rounded-full border border-paper/15 px-2.5 py-1 font-mono text-[0.6875rem] leading-none text-paper-dim @2xl:inline-block">{route}</span>}
    </div>
  );
}

/** The progress line: one segment per beat, filled as the replay moves through it. */
export function BeatSegments({ index, progress }: { index: number; progress: number }) {
  return (
    <div className="flex gap-1">
      {DEMO_BEATS.map((beat, i) => (
        <span key={beat} className="h-1 flex-1 overflow-hidden rounded-full bg-paper/15">
          <span className="block h-full rounded-full bg-paper" style={{ width: `${i < index ? 100 : i === index ? Math.round(progress * 1000) / 10 : 0}%` }} />
        </span>
      ))}
    </div>
  );
}

/** What shows while the player loads: the same frame, an empty stage and an empty progress line. */
export function DemoPlaceholder({ label }: { label: string }) {
  return (
    <div>
      <TopBar label={label} />
      <div className={STAGE_BOX} />
      <div className={cn(BAR_BOX)}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <BeatSegments index={-1} progress={0} />
          <p className="font-mono text-[0.6875rem] leading-4 text-paper-dim">Loading the replay</p>
        </div>
      </div>
    </div>
  );
}
