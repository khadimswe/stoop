"use client";

import { ArrowRight, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import { demoTimeline, frameAt } from "@/lib/marketing/demo-timeline";
import { DEMO_BEAT_LABELS, type DemoBeat, type DemoScript } from "@/lib/marketing/demo-types";
import { BeatSegments, TopBar } from "./chrome";
import { ComposerBeat } from "./composer-beat";
import { LaunchPlanBeat } from "./launch-plan";
import { BAR_BOX, STAGE_BOX } from "./parts";
import { RealityBeat, StoryboardBeat, WorldsBeat } from "./report-beats";
import { SeedsBeat } from "./seeds-beat";
import { TraceBeat } from "./trace-beat";

export interface AgentDemoPlayerProps {
  script: DemoScript;
}

/** Re-render at most this often (ms): smooth enough for typing and the progress line, light on the main thread. */
const TICK = 40;
/** A long frame (a stalled tab) never jumps the replay ahead by more than this. */
const MAX_STEP = 100;

/** True while the element is at least partly on screen. */
function useOnScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, onScreen];
}

/** False while the tab is in the background. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * The replay's clock: while `running`, it advances `elapsed` (the caller's, so Replay can reset it),
 * loops at `total`, and shows the time through `setT` at most every TICK ms.
 */
function useReplayClock(total: number, running: boolean, elapsed: RefObject<number>, setT: Dispatch<SetStateAction<number>>) {
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last !== null) {
        elapsed.current += Math.min(now - last, MAX_STEP);
        if (elapsed.current >= total) elapsed.current = 0;
        const shown = Math.floor(elapsed.current / TICK) * TICK;
        setT((prev) => (prev === shown ? prev : shown));
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, total, elapsed, setT]);
}

const ROUTE: Record<DemoBeat, keyof DemoScript["routes"]> = {
  composer: "start",
  seeds: "start",
  trace: "run",
  reality: "report",
  worlds: "report",
  storyboard: "report",
  launch: "report",
};

/**
 * The replay itself: one clock drives every beat, from the composer to the launch plan. It starts once
 * it is on screen, stops while it is off screen or the tab is hidden, and loops. Under reduced motion
 * it never plays: it shows the end of the run and steps through the beats on request.
 * The animated stage is hidden from screen readers (the region carries a summary instead).
 */
export function AgentDemoPlayer({ script }: AgentDemoPlayerProps) {
  const timeline = useMemo(() => demoTimeline(script), [script]);
  const reduced = usePrefersReducedMotion();
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const pageVisible = usePageVisible();
  const [paused, setPaused] = useState(false);
  /**
   * Whether the pointer or the keyboard focus is anywhere on the demo. On the end card, the replay
   * holds while either is, so "Open the full report" never vanishes under someone reading or reaching for it.
   */
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  /** The beats with something to show (a run with no storyboard skips that beat). */
  const shown = useMemo(() => timeline.beats.flatMap((span, i) => (span.end > span.start ? [i] : [])), [timeline]);
  /** Reduced motion: the beat whose end is showing, starting at the last (the end of the run). */
  const [step, setStep] = useState(() => shown.at(-1) ?? 0);
  const elapsed = useRef(0);
  const [t, setClock] = useState(0);
  const frame = frameAt(timeline, script, reduced ? timeline.beats[step].end : t);
  const { beat } = frame;
  const showCta = beat === "launch" && frame.launch.cta;
  // Only on the end card: earlier beats play on under the pointer. The end card itself lasts at least
  // END_CARD_MS (lib/marketing/demo-timeline.ts) before the loop, and never loops while held.
  const held = showCta && (hovering || focused);
  const playing = !reduced && !paused && !held && onScreen && pageVisible;
  useReplayClock(timeline.total, playing, elapsed, setClock);

  const replay = () => {
    elapsed.current = 0;
    setClock(0);
    setPaused(false);
  };
  const stepThrough = () => setStep((current) => shown[(shown.indexOf(current) + 1) % shown.length]);

  let stage: ReactNode;
  switch (beat) {
    case "composer":
      stage = <ComposerBeat script={script} frame={frame.composer} />;
      break;
    case "seeds":
      stage = <SeedsBeat script={script} frame={frame.seeds} />;
      break;
    case "trace":
      stage = <TraceBeat script={script} frame={frame.trace} />;
      break;
    case "reality":
      stage = <RealityBeat script={script} frame={frame.reality} />;
      break;
    case "worlds":
      stage = <WorldsBeat script={script} frame={frame.worlds} />;
      break;
    case "storyboard":
      stage = <StoryboardBeat script={script} frame={frame.storyboard} />;
      break;
    case "launch":
      stage = <LaunchPlanBeat plan={script.launchPlan} cells={frame.launch.rows} />;
      break;
  }
  return (
    <div
      ref={ref}
      // A mouse resting on the demo holds the end card; a tap (touch, pen) never leaves it held.
      onPointerEnter={(event) => setHovering(event.pointerType === "mouse")}
      onPointerMove={(event) => setHovering(event.pointerType === "mouse")}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => setFocused(event.currentTarget.contains(event.relatedTarget as Node | null))}
      data-demo-beat={beat} data-demo-playing={playing ? "true" : "false"} data-demo-mode={reduced ? "steps" : "autoplay"} data-demo-steps={frame.trace.steps}>
      <TopBar label={script.label} route={script.routes[ROUTE[beat]]} live={playing} />
      <div className={STAGE_BOX}>
        <div aria-hidden="true" key={beat} className="absolute inset-0 p-4 motion-safe:animate-rise @2xl:p-6 @4xl:p-8">
          {stage}
        </div>
        {showCta && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-4 motion-safe:animate-rise @2xl:justify-end @2xl:p-6 @4xl:p-8">
            <Button asChild>
              <Link href={script.reportHref}>
                Open the full report
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )}
      </div>
      <div className={BAR_BOX}>
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-1.5">
          <BeatSegments index={frame.index} progress={frame.progress} shown={shown} />
          <p className="truncate font-mono text-[0.6875rem] leading-4 text-paper-dim">
            {Math.max(1, shown.indexOf(frame.index) + 1)} of {shown.length} · {DEMO_BEAT_LABELS[beat]}
          </p>
        </div>
        {reduced ? (
          <Button type="button" variant="screen" className="h-11 px-4" onClick={stepThrough}>
            Step through
            <ChevronRight aria-hidden="true" />
          </Button>
        ) : (
          <>
            <Button type="button" variant="screen" size="icon" className="size-11" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play the replay" : "Pause the replay"}>
              {paused ? <Play aria-hidden="true" className="translate-x-px" /> : <Pause aria-hidden="true" />}
            </Button>
            <Button type="button" variant="screen" size="icon" className="size-11" onClick={replay} aria-label="Replay from the start">
              <RotateCcw aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
