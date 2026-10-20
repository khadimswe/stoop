"use client";

import { useEffect } from "react";
import { receiptKeyOf } from "@/lib/report/view/deep-link";
import { REPORT_SECTIONS } from "../report-section";

/**
 * Opens a receipt from the URL: "#receipt-music" (or any "#receipt-<cue>") scrolls to the Screening
 * Room and opens that cue's receipt on the first world row that carries it, the way a tap would, so
 * focus moves into the drawer and returns to the chip when it closes. Without a matching chip it
 * still lands on the Screening Room. Renders nothing.
 */
export function ReceiptDeepLink() {
  useEffect(() => {
    const open = () => {
      const key = receiptKeyOf(window.location.hash);
      if (!key) return;
      const room = document.getElementById(REPORT_SECTIONS.screening);
      if (!room) return;
      const trigger = room.querySelector<HTMLElement>(`[data-receipt-cue="${CSS.escape(key)}"]`);
      if (!trigger) {
        room.scrollIntoView({ block: "start" });
        return;
      }
      trigger.scrollIntoView({ block: "center" });
      trigger.click();
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
