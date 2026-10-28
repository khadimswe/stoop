"use client";

import { ReceiptText } from "lucide-react";
import { ReceiptTrigger } from "./receipts";

/** A text-only "See the receipt" button. Not rendered without a receipt. */
export function ReceiptLink({ receiptKey, label = "See the receipt", context }: { receiptKey: string | null; label?: string; context?: string }) {
  return (
    <ReceiptTrigger receiptKey={receiptKey}>
      <button
        type="button"
        className="relative inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-ink underline decoration-1 underline-offset-4 after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:decoration-brick"
      >
        <ReceiptText aria-hidden="true" className="size-3.5" />
        {label}
        {context && <span className="sr-only">: {context}</span>}
      </button>
    </ReceiptTrigger>
  );
}
