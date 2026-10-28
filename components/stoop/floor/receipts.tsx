"use client";

import { X } from "lucide-react";
import { createContext, useContext, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { ReceiptView } from "@/lib/report/view/types";
import type { CueOrigin } from "@/lib/types";
import { cn } from "cn";

const Receipts = createContext<Readonly<Record<string, ReceiptView>>>({});
const noSubscription = () => () => {};

/** Every receipt on a floor page, sent once and opened by key. */
export function FloorReceipts({ receipts, children }: { receipts: Readonly<Record<string, ReceiptView>>; children: ReactNode }) {
  return <Receipts.Provider value={receipts}>{children}</Receipts.Provider>;
}

function Panel({ receipt, onClose }: { receipt: ReceiptView; onClose: () => void }) {
  return (
    <div className="floor flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-[20px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-fl-ink">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-fl-muted">
            <i aria-hidden="true" className={cn("block size-2 rounded-[2px]", receipt.subject === "generic" ? "border-[1.5px] border-dashed border-fl-ink" : "bg-fl-ink")} />
            {receipt.subject === "generic" ? "Generic AI plan, checked with Qloo" : `Why Qloo picked this · ${receipt.cue}`}
          </p>
          <p className="font-serif text-2xl leading-tight text-pretty">{receipt.title}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-[12px] hover:bg-fl-band">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        {receipt.rows.map((row, i) => (
          <div key={`${i}-${row.label}`} className="contents">
            <dt className="text-fl-dim">{row.label}</dt>
            <dd className={cn("min-w-0 break-words", row.mono && "font-mono text-[0.8125rem]")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-fl-rule pt-3 text-xs text-fl-dim">The exact Qloo request. The API key is never shown. Aggregate taste data, never a shopper.</p>
    </div>
  );
}

/** Opens one receipt: a dialog on desktop, a bottom sheet on phones. Not rendered without a receipt. */
export function ReceiptTrigger({ receiptKey, fallback = null, children }: { receiptKey: string | null; fallback?: ReactNode; children: ReactElement }) {
  const receipts = useContext(Receipts);
  const receipt = receiptKey ? receipts[receiptKey] : undefined;
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [open, setOpen] = useState(false);
  if (!receipt) return <>{fallback}</>;
  const title = `Receipt: ${receipt.cue}`;
  return (
    <Dialog open={mounted && open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {desktop ? (
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="gap-0 bg-transparent p-0 ring-0 sm:max-w-lg">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <Panel receipt={receipt} onClose={() => setOpen(false)} />
        </DialogContent>
      ) : (
        <SheetContent side="bottom" showCloseButton={false} aria-describedby={undefined} className="max-h-[85dvh] gap-0 rounded-t-[20px] border-0 bg-white p-0">
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <Panel receipt={receipt} onClose={() => setOpen(false)} />
        </SheetContent>
      )}
    </Dialog>
  );
}

const MARK: Record<CueOrigin, string> = {
  qloo: "bg-fl-ink rounded-[2px]",
  interpreted: "bg-fl-ink rounded-[2px]",
  yours: "border-[1.5px] border-fl-ink rounded-full",
  creative: "border-[1.5px] border-dashed border-fl-ink rounded-full",
};
const WORDS: Record<CueOrigin, string> = { qloo: "Qloo", interpreted: "Qloo", yours: "Your choice", creative: "Creative suggestion" };

/**
 * Where a line came from, as an 8 px mark and words: Qloo (a filled square), Your choice (a ring),
 * Creative suggestion (a dashed ring). A Qloo line with a receipt reads "Why Qloo picked this" and
 * opens it. `extra` follows the words ("· 440 m").
 */
export function OriginTag({ origin, receiptKey = null, extra, context }: { origin: CueOrigin; receiptKey?: string | null; extra?: string; context?: string }) {
  const qloo = origin === "qloo" || origin === "interpreted";
  const body = (why: boolean) => (
    <>
      <i aria-hidden="true" className={cn("block size-2 shrink-0", MARK[origin])} />
      <span>
        {why ? "Why Qloo picked this" : WORDS[origin]}
        {origin === "creative" && <span className="sr-only"> (not from Qloo)</span>}
        {extra && <span className="text-fl-dim"> · {extra}</span>}
      </span>
    </>
  );
  const plain = <span className="inline-flex items-center gap-1.5 text-xs leading-4 font-medium whitespace-nowrap text-fl-muted">{body(false)}</span>;
  if (!qloo || !receiptKey) return plain;
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={plain}>
      <button
        type="button"
        className="relative inline-flex items-center gap-1.5 rounded-[6px] text-xs leading-4 font-medium whitespace-nowrap text-fl-ink underline decoration-fl-line underline-offset-[3px] after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-fl-ink"
      >
        {body(true)}
        {context && <span className="sr-only">: {context}</span>}
      </button>
    </ReceiptTrigger>
  );
}

/** A section's "Qloo" tag that opens the section's receipt ("Why Qloo picked this"). */
export function QlooTag({ receiptKey, context }: { receiptKey: string | null; context?: string }) {
  return <OriginTag origin="qloo" receiptKey={receiptKey} context={context} />;
}
