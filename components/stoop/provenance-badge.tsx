"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

const KIND = {
  recorded: {
    label: "Recorded Qloo",
    dot: "bg-dusk",
    tip: "Real Qloo responses, saved so this loads instantly. Nothing here is made up.",
  },
  live: { label: "Live Qloo", dot: "bg-dusk", tip: "Fresh Qloo responses from this run." },
  partial: {
    label: "Partial data",
    dot: "bg-rose-deep",
    tip: "Some Qloo calls failed, so parts of this report come from cache. Gaps are labeled.",
  },
  placeholder: {
    label: "Placeholder",
    dot: "bg-concrete-line",
    tip: "Not Qloo data yet. Real values appear once this example is recorded.",
  },
} as const;

/** Tells the viewer where a report's data came from. */
export function ProvenanceBadge({
  kind,
  date,
  className,
}: {
  kind: keyof typeof KIND;
  date?: string;
  className?: string;
}) {
  const { label, dot, tip } = KIND[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-paper-raised px-3 py-1 font-mono text-[0.75rem] font-medium tracking-wide text-ink uppercase",
            className,
          )}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
          {label}
          {date && <span className="text-ink-soft">· {date}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{tip}</TooltipContent>
    </Tooltip>
  );
}
