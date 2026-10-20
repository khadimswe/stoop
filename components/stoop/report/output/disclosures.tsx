"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface DisclosureItem {
  key: string;
  /** The button's words, e.g. "Production Pack". */
  label: string;
  /** Spoken in place of `label` when the visible words need their context ("Production Pack, Control"). */
  name?: string;
  /** What the button reveals: the line's full content, rendered on the server. */
  content: ReactNode;
}

/**
 * One Output line: `lead` (a copy button, a thumbnail strip, a short summary) and a row of disclosure
 * buttons, then each opened panel below the row, in the order of the buttons. Each button is a real
 * button with aria-expanded and aria-controls; focus stays on it when its panel opens, and a closed
 * panel is `hidden`, so nothing inside it takes focus.
 */
export function Disclosures({ lead, items, className }: { lead?: ReactNode; items: DisclosureItem[]; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {lead}
        {items.map((item) => {
          const expanded = open.has(item.key);
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-controls={`${id}-${item.key}`}
              aria-label={item.name}
              onClick={() => toggle(item.key)}
              className="h-11 gap-1 px-2 text-[0.8125rem] focus-visible:outline-solid sm:h-9 sm:px-3 sm:text-sm"
            >
              {item.label}
              <ChevronDown aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
            </Button>
          );
        })}
      </div>
      {items.map((item) => (
        <div key={item.key} id={`${id}-${item.key}`} hidden={!open.has(item.key)} className="min-w-0">
          {item.content}
        </div>
      ))}
    </div>
  );
}
