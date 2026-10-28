"use client";

import { Chip } from "@/components/stoop/chip";
import type { CueOrigin } from "@/lib/types";
import { ReceiptTrigger } from "./receipts";

/** What each origin reads on a plan line. Creative lines print the full words, never just a tag. */
export const ORIGIN_LABELS: Readonly<Record<CueOrigin, string>> = {
  qloo: "Qloo",
  interpreted: "From Qloo",
  creative: "Creative suggestion (not from Qloo)",
  yours: "Your choice",
};

/**
 * A plan line's origin as a chip: dusk for Qloo, dashed concrete for "Creative suggestion (not from
 * Qloo)", an ink outline for "Your choice". A Qloo-backed line's chip opens its receipt.
 */
export function OriginTag({ origin, receiptKey, context }: { origin: CueOrigin; receiptKey: string | null; context?: string }) {
  const chip = <Chip origin={origin}>{ORIGIN_LABELS[origin]}</Chip>;
  if (origin !== "qloo" && origin !== "interpreted") return chip;
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={chip}>
      <button type="button" className="relative rounded-full after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] hover:[&>span]:underline">
        {chip}
        <span className="sr-only">, see the receipt{context ? ` for ${context}` : ""}</span>
      </button>
    </ReceiptTrigger>
  );
}
