import type { ReactNode } from "react";
import { cn } from "cn";

/** A rubber stamp ("Qloo verified", "Cliche flagged"). One of only two places the sticker shadow appears. */
export function Stamp({
  tone,
  animate = true,
  className,
  children,
}: {
  tone: "qloo" | "flagged";
  animate?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block -rotate-6 rounded-lg border-[3px] border-double px-3 py-1.5 font-display text-sm font-extrabold tracking-wide uppercase shadow-sticker-sm [font-stretch:85%]",
        tone === "qloo" ? "border-ink bg-dusk text-paper" : "border-ink bg-rose-deep text-paper",
        animate && "motion-safe:animate-stamp",
        className,
      )}
    >
      {children}
    </span>
  );
}
