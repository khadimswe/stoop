"use client";

import type { MouseEvent, ReactNode } from "react";
import { ReceiptTrigger } from "@/components/stoop/floor/receipts";

/**
 * Stops the link's own navigation once the receipt trigger (inside) has opened the dialog. A click
 * with a modifier (open in a new tab or window) keeps the browser's own behavior. Clicks inside the
 * open receipt also reach this wrapper (React bubbles them up from the dialog's portal), so only a
 * click on the link itself, in the page, is stopped; the receipt's own toggles and links still work.
 */
const stay = (event: MouseEvent<HTMLElement>) => {
  if (!event.currentTarget.contains(event.target as Node)) return;
  if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) event.preventDefault();
};

/**
 * A Qloo pick as a link that opens its receipt. Without JavaScript it is a plain link to the same
 * fact on the example's own page (its community row, or the playlist with its receipt open). With it,
 * the receipt opens in place. `receiptKey` must be one of the receipts the surrounding FloorReceipts
 * was given, or null for a plain link.
 */
export function ReceiptLink({ receiptKey, href, className, label, children }: { receiptKey: string | null; href: string; className?: string; label?: string; children: ReactNode }) {
  const link = (
    <a href={href} className={className} aria-label={label}>
      {children}
    </a>
  );
  if (!receiptKey) return link;
  return (
    // The dialog's trigger toggles first; this wrapper then keeps the browser on the page.
    <span onClick={stay} className="contents">
      <ReceiptTrigger receiptKey={receiptKey} fallback={link}>
        {link}
      </ReceiptTrigger>
    </span>
  );
}
