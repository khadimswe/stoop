"use client";

import { BadgeCheck, PenLine, UserRound } from "lucide-react";
import type { CueOrigin } from "@/lib/types";
import { ReceiptTrigger } from "./receipts";

/**
 * A plan line's source, small: "Why Qloo picked this" (dusk, opens the receipt) for Qloo-backed
 * lines, "Not from Qloo" (dashed concrete) for creative ones, "Your choice" (ink) for the manager's.
 */
export function OriginTag({ origin, receiptKey, context }: { origin: CueOrigin; receiptKey: string | null; context?: string }) {
  const base = "inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 text-xs font-semibold";
  if (origin === "yours")
    return (
      <span className={`${base} border-ink text-ink`}>
        <UserRound aria-hidden="true" className="size-3" />
        Your choice
      </span>
    );
  if (origin === "creative")
    return (
      <span className={`${base} border-dashed border-concrete-line text-ink-soft`}>
        <PenLine aria-hidden="true" className="size-3" />
        Not from Qloo
        <span className="sr-only">: a creative suggestion</span>
      </span>
    );
  const label = (
    <>
      <BadgeCheck aria-hidden="true" className="size-3" />
      Why Qloo picked this
    </>
  );
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={<span className={`${base} border-dusk text-dusk`}>{label}</span>}>
      <button type="button" className={`${base} relative border-dusk text-dusk after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] hover:bg-dusk-soft`}>
        {label}
        {context && <span className="sr-only">: {context}</span>}
      </button>
    </ReceiptTrigger>
  );
}
