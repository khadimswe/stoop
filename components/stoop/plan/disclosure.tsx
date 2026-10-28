import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A closed-by-default row that opens in place: a native <details>, so it works without JavaScript,
 * from the keyboard and with screen readers. `meta` is a short count on the right ("6 steps").
 */
export function Disclosure({ title, meta, id, defaultOpen = false, className, children }: { title: string; meta?: string; id?: string; defaultOpen?: boolean; className?: string; children: ReactNode }) {
  return (
    <details id={id} open={defaultOpen} className={cn("group/disc scroll-mt-28 border-b border-hairline", className)}>
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex-1 text-[0.9375rem] font-semibold">{title}</span>
        {meta && <span className="font-mono text-xs text-ink-soft">{meta}</span>}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-soft transition-transform group-open/disc:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}
