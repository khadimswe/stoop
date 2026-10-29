"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

const KIND = {
  recorded: {
    label: "Recorded Qloo",
    dot: "bg-dusk",
    tip: "Real Qloo responses, saved so this loads instantly.",
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

/**
 * Tells the viewer where a report's data came from. Its explanation opens on tap or click (a popover,
 * not a hover-only tooltip), so it works on phones and from the keyboard; Esc or a tap outside closes it.
 */
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
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-paper-raised px-3 py-1 font-mono text-[0.75rem] font-medium tracking-wide text-ink uppercase after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] aria-expanded:bg-sand",
            className,
          )}
        >
          <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
          {label}
          {date && <span className="text-ink-soft">· {date}</span>}
          <span className="sr-only"> (what this means)</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={`What ${label} means`}
        align="start"
        sideOffset={8}
        collisionPadding={{ top: 64, right: 12, bottom: 12, left: 12 }}
        className="w-auto max-w-72 rounded-xl border border-hairline bg-surface p-3 text-sm text-pretty text-ink shadow-l2 ring-0"
      >
        {tip}
      </PopoverContent>
    </Popover>
  );
}
