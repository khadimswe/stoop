"use client";

import { useState, useSyncExternalStore, type ReactElement } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { ReceiptView } from "@/lib/report/view/types";
import { ReceiptPanel } from "./receipt-panel";

const noSubscription = () => () => {};

/**
 * One receipt (demo beat 3) behind a trigger: a centered dialog on desktop, a bottom sheet on phones.
 * Both are the same Radix dialog, so focus is trapped, Esc closes it and focus returns to the trigger.
 * `children` is the trigger: one focusable element, such as a Button or a chip rendered as a button.
 * `defaultOpen` opens it on arrival (the landing's "See why it works" opens the music style receipt).
 */
export function ReceiptDrawer({
  receipt,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
}: {
  receipt: ReceiptView;
  children: ReactElement;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const desktop = useMediaQuery("(min-width: 640px)", true);
  // Opens only once the browser has said which variant fits, so a phone arriving with
  // `defaultOpen` never flashes the desktop dialog first.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [openState, setOpenState] = useState(defaultOpen);
  const open = mounted && (openProp ?? openState);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const title = `Receipt: ${receipt.cue}`;
  const panel = (className: string) => (
    <ReceiptPanel cue={receipt.cue} title={receipt.title} rows={receipt.rows} note={receipt.note} subject={receipt.subject} onClose={() => setOpen(false)} className={className} />
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {desktop ? (
        <DialogContent showCloseButton={false} aria-describedby={undefined} className="gap-0 bg-transparent p-0 ring-0 sm:max-w-lg">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {panel("max-h-[85vh] overflow-y-auto")}
        </DialogContent>
      ) : (
        <SheetContent side="bottom" showCloseButton={false} aria-describedby={undefined} className="max-h-[85dvh] gap-0 rounded-t-3xl border-t border-hairline bg-surface p-0">
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {panel("overflow-y-auto rounded-none border-0 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-none")}
        </SheetContent>
      )}
    </Dialog>
  );
}
