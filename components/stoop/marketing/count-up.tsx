"use client";

import { useEffect, useRef, useState } from "react";
import { COUNT_UP_MS, figurePartsAt, figureText, type FigurePart } from "@/lib/marketing/count-up";
import { cn } from "cn";

/**
 * A recorded number that counts up from 0 once, when it scrolls into view. The server renders the
 * final value, so it reads the same without JavaScript and under reduced motion (the count never
 * starts). A figure already on screen when the page loads keeps its value: it never jumps back to 0.
 * The final figure, invisible, holds the box's size, so the count never shifts the layout; screen
 * readers get the final value only.
 */
export function CountUp({ parts, className, smallClassName }: { parts: FigurePart[]; className?: string; smallClassName?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // 1 is the finished count: what the server and a page without JavaScript show.
  const [progress, setProgress] = useState(1);
  const final = figureText(parts);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let armed = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!armed) {
          // The first report says where the figure is at load. Below the fold: wind back to 0, out of
          // sight, ready to count. On screen or already scrolled past: keep the recorded value.
          if (entry.isIntersecting || entry.boundingClientRect.top <= 0) return observer.disconnect();
          armed = true;
          setProgress(0);
          return;
        }
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / COUNT_UP_MS);
          setProgress(t);
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const render = (texts: string[]) =>
    parts.map((part, i) => (
      <span key={i} className={part.size === "sm" ? cn("text-[0.36em] tracking-normal", smallClassName) : undefined}>
        {texts[i]}
      </span>
    ));

  return (
    <span ref={ref} data-count-up={final} className={cn("relative inline-block whitespace-nowrap tabular-nums", className)}>
      <span aria-hidden="true" className="invisible">
        {render(figurePartsAt(parts, 1))}
      </span>
      <span aria-hidden="true" data-count-up-live="" className="absolute inset-0">
        {render(figurePartsAt(parts, progress))}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
