import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import type { ReceiptView } from "@/lib/report/view/types";
import { cn } from "cn";

/**
 * One measured fact as an underlined button that opens its receipt ("55 and older skews +0.21",
 * "set in Slidell, LA"). Without a receipt it is plain text. The hit area grows to 44 px tall without
 * moving the line. Used on the Screening Room's dark rows and in the theater's white panel.
 */
export function Fact({ text, receipt, surface = "screen", className }: { text: string; receipt: ReceiptView | null; surface?: "paper" | "screen"; className?: string }) {
  if (!receipt) return <span className={className}>{text}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button
        type="button"
        className={cn(
          "relative rounded-sm text-left underline decoration-1 underline-offset-4 after:absolute after:-inset-x-0.5 after:-inset-y-3.5 after:content-['']",
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
