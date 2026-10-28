"use client";

import { BadgeCheck } from "lucide-react";
import { cn } from "cn";
import type { TextPart } from "@/lib/plan/view/plan";
import { ReceiptTrigger } from "./receipts";

/**
 * A measured artist or place, named in a plan line: its real name from the run's Qloo results, as a
 * solid dusk chip (Qloo decided) that opens its receipt. Without a receipt it reads as plain text.
 */
export function RefChip({ name, receiptKey, surface = "paper", className }: { name: string; receiptKey: string | null; surface?: "paper" | "screen"; className?: string }) {
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={<span className="font-semibold">{name}</span>}>
      <button
        type="button"
        className={cn(
          "relative mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 align-baseline text-[0.8125rem] leading-tight font-semibold after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:underline",
          surface === "paper" ? "border-dusk bg-dusk text-paper" : "border-dusk-light bg-dusk-light text-screen",
          className,
        )}
      >
        <BadgeCheck aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only">From Qloo: </span>
        <span className="truncate">{name}</span>
        <span className="sr-only">, see the receipt</span>
      </button>
    </ReceiptTrigger>
  );
}

/**
 * Plan text with its "[[id]]" refs rendered by name (lib/plan/view/plan.ts splits them): as chips that
 * open their receipts, or with `quiet`, as dusk names only (the line's own "Why Qloo picked this"
 * opens the receipt that lists them).
 */
export function RichText({ parts, quiet = false, className }: { parts: readonly TextPart[]; quiet?: boolean; className?: string }) {
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <span key={i}>{part.text}</span>
        ) : quiet ? (
          <span key={i} className="font-semibold text-dusk">
            <BadgeCheck aria-hidden="true" className="mr-0.5 inline size-3.5 align-[-0.125em]" />
            <span className="sr-only">From Qloo: </span>
            {part.name}
          </span>
        ) : (
          <RefChip key={i} name={part.name} receiptKey={part.receipt} />
        ),
      )}
    </span>
  );
}
