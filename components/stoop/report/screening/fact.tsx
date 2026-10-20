import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import type { ReceiptView } from "@/lib/report/view/types";
import { cn } from "cn";

/**
 * One measured fact as an underlined button that opens its receipt ("55 and older skews +0.21",
 * "set in <its setting city>"). Without a receipt it is plain text. The button itself is 44 px tall, so when
 * facts wrap onto several lines no fact's tap area covers another's. Used on the Screening Room's
 * dark rows and in the theater's white panel. `deepLink` is the "#receipt-<key>" it answers to.
 */
export function Fact({
  text,
  receipt,
  surface = "screen",
  deepLink,
  className,
}: {
  text: string;
  receipt: ReceiptView | null;
  surface?: "paper" | "screen";
  deepLink?: string;
  className?: string;
}) {
  if (!receipt) return <span className={cn("inline-flex min-h-11 items-center", className)}>{text}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button
        type="button"
        data-receipt-cue={deepLink}
        className={cn(
          "inline-flex min-h-11 items-center rounded-sm text-left underline decoration-1 underline-offset-4",
          surface === "screen" ? "decoration-paper-dim hover:text-paper hover:decoration-paper" : "decoration-concrete-line hover:text-ink hover:decoration-ink",
          className,
        )}
      >
        {text}
        <span className="sr-only"> (open receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}
