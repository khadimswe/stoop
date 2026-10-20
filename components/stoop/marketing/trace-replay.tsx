"use client";

import { Check, GitBranch, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Screen } from "@/components/stoop/screen";
import { Button } from "@/components/ui/button";
import { usePrefersReducedMotion } from "@/hooks/use-media-query";
import type { ReplayView } from "@/lib/marketing/landing";
import { cn } from "cn";

const STEP_MS = 1800;

/**
 * "Watch the agent build this": the lead example's recorded trace, folded into five steps. Every
 * step and line is always in the page (no layout shift, nothing hidden from screen readers); the
 * replay only moves a highlight down the list, once, when it scrolls into view, and never under
 * reduced motion. "Replay" runs it again. Zero network calls: it is the recorded run.
 * A stand-in until the live-flow lane's TraceList lands.
 */
export function TraceReplay({ view }: { view: ReplayView }) {
  const reducedMotion = usePrefersReducedMotion();
  const total = view.steps.length;
  // `active` is the step being worked on; `total` means done. The server renders the finished run.
  const [active, setActive] = useState(total);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const played = useRef(false);

  const play = useCallback(() => {
    clearInterval(timer.current);
    setActive(0);
    timer.current = setInterval(() => {
      setActive((current) => {
        if (current + 1 >= total) clearInterval(timer.current);
        return Math.min(current + 1, total);
      });
    }, STEP_MS);
  }, [total]);

  useEffect(() => () => clearInterval(timer.current), []);

  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion || played.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || played.current) return;
        // Still below the fold: wind back to the start, so the replay is ready when it comes into view.
        if (!entry.isIntersecting) {
          if (entry.boundingClientRect.top > 0) setActive(0);
          return;
        }
        played.current = true;
        observer.disconnect();
        play();
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [play, reducedMotion]);

  const running = active < total;

  return (
    <Screen ref={ref} className="flex min-w-0 flex-col gap-1 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <p className="font-mono text-xs text-paper-dim">
          {view.brand} · recorded {view.date}
        </p>
        <Button variant="screen" size="sm" onClick={play} disabled={running} className="h-9 pointer-coarse:h-11">
          <RotateCcw aria-hidden="true" />
          {running ? "Replaying" : "Replay"}
        </Button>
      </div>
      <ol className="flex flex-col">
        {view.steps.map((step, i) => {
          const state = i < active ? "done" : i === active ? "active" : "waiting";
          return (
            <li
              key={step.id}
              className={cn(
                "flex gap-3 rounded-xl border-t border-paper/10 px-2 py-3.5 transition-colors duration-300",
                state === "active" && "bg-screen-raised",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                  // Progress is the agent's, not Qloo's: paper, never dusk.
                  state === "done" && "border-paper bg-paper text-screen",
                  state === "active" && "border-paper text-paper motion-safe:animate-pulse",
                  state === "waiting" && "border-paper-dim/60",
                )}
              >
                {state === "done" && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className={cn("text-base font-semibold", state === "waiting" ? "text-paper-dim" : "text-paper")}>{step.title}</p>
                  {step.calls > 0 ? (
                    <span className="rounded-full border-[1.5px] border-dusk-light px-2.5 py-0.5 font-mono text-[0.6875rem] text-dusk-light">
                      {step.calls} Qloo {step.calls === 1 ? "call" : "calls"}
                    </span>
                  ) : (
                    <span className="rounded-full border-[1.5px] border-dashed border-concrete-screen px-2.5 py-0.5 font-mono text-[0.6875rem] text-concrete-screen">
                      No Qloo calls
                    </span>
                  )}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {step.lines.map((line, j) => (
                    <li key={j} className="flex gap-2 text-sm leading-snug text-paper-dim">
                      {line.kind === "tool" ? (
                        <Search aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      ) : (
                        <GitBranch aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-paper" />
                      )}
                      <span className="min-w-0">
                        <span className="sr-only">{line.kind === "tool" ? "Qloo call: " : "Decision: "}</span>
                        <span className={cn(line.kind === "decision" && state !== "waiting" && "text-paper")}>{line.label}</span>
                        {line.reason && <span className="block text-xs text-paper-dim">{line.reason}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="border-t border-paper/10 pt-3 font-mono text-xs text-paper-dim">
        {view.calls} Qloo calls, {view.cached === view.calls ? "all replayed from the recording" : `${view.cached} from cache`} · zero live calls
      </p>
    </Screen>
  );
}
