"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PromptOptionView } from "@/lib/report/view/kit";
import { cn } from "cn";

function CopyItem({ option }: { option: PromptOptionView }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const ok = await copyText(option.text, event.currentTarget.parentElement ?? document.body);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-fill focus-visible:bg-fill"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{state === "copied" ? `Copied: ${option.label}` : `Copy ${option.label}`}</span>
          <span className="text-xs text-ink-soft">{option.detail}</span>
        </span>
        {state === "copied" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <Copy aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? `Copied ${option.label}` : state === "failed" ? "Copy failed. Open the kit download and copy it from there." : ""}
      </span>
    </>
  );
}

function Group({ title, options }: { title: string; options: PromptOptionView[] }) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pt-1 font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">{title}</p>
      <ul className="flex flex-col">
        {options.map((option) => (
          <li key={option.id}>
            <CopyItem option={option} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The kit card's "Prompts" menu: every copy-ready prompt for this creative, by model (names from
 * models.config) and AI-actor tool. Each entry copies its text; nothing renders or posts from here.
 */
export function PromptsMenu({ video, actor, title, className }: { video: PromptOptionView[]; actor: PromptOptionView[]; title: string; className?: string }) {
  if (video.length === 0 && actor.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("h-11 gap-1 px-3 sm:h-9", className)} aria-label={`Prompts for ${title}`}>
          Prompts
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        // Clear of the 56 px app bar and the sticky section nav above, and the sticky bar below: the
        // menu flips or shrinks to fit between them, never over the site header.
        collisionPadding={{ top: 112, right: 12, bottom: 88, left: 12 }}
        aria-label={`Prompts for ${title}`}
        className="max-h-[min(70dvh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] gap-2 overflow-y-auto rounded-xl border border-hairline bg-surface p-2 shadow-l2 ring-0">
        <Group title="Video prompts" options={video} />
        <Group title="AI actor scripts" options={actor} />
        <p className="border-t border-hairline px-2.5 pt-2 pb-1 text-xs text-ink-soft">Stoop is the brain, you bring your own camera. Review every prompt before you render.</p>
      </PopoverContent>
    </Popover>
  );
}
