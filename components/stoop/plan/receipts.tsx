"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import type { ReceiptView } from "@/lib/report/view/types";
import { ReceiptDrawer } from "../receipt-drawer";

const Receipts = createContext<Readonly<Record<string, ReceiptView>>>({});

/**
 * Every receipt on a plan page, sent once (lib/plan/view/plan.ts builds them from the run's ledger)
 * and looked up by key, so a place named in five lines carries its receipt once.
 */
export function PlanReceipts({ receipts, children }: { receipts: Readonly<Record<string, ReceiptView>>; children: ReactNode }) {
  return <Receipts.Provider value={receipts}>{children}</Receipts.Provider>;
}

/**
 * Opens one receipt behind its trigger (a dialog on desktop, a bottom sheet on phones). Without a
 * receipt for the key the trigger is not rendered: no evidence, no receipt button.
 */
export function ReceiptTrigger({ receiptKey, fallback = null, children }: { receiptKey: string | null; fallback?: ReactNode; children: ReactElement }) {
  const receipts = useContext(Receipts);
  const receipt = receiptKey ? receipts[receiptKey] : undefined;
  if (!receipt) return <>{fallback}</>;
  return <ReceiptDrawer receipt={receipt}>{children}</ReceiptDrawer>;
}
