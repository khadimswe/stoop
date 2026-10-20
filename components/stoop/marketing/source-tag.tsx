import type { CardSource } from "@/lib/marketing/landing";
import { cn } from "cn";

// Who a Reality Check line speaks for. Color is never the only signal: every tag is a word, and the
// two "not from Qloo" sources say so in full.
const LABEL: Record<CardSource, string> = {
  brand: "Brand",
  site: "Read from their site · not from Qloo",
  qloo: "Qloo",
  generic: "Generic AI brief · not from Qloo",
};

const STYLE = {
  paper: {
    brand: "border-ink text-ink",
    site: "border-dashed border-concrete-line text-ink-soft",
    qloo: "border-dusk bg-dusk text-paper",
    generic: "border-dashed border-concrete-line text-ink-soft",
  },
  screen: {
    brand: "border-paper text-paper",
    site: "border-dashed border-concrete-screen text-concrete-screen",
    qloo: "border-dusk-light bg-dusk-light text-screen",
    generic: "border-dashed border-concrete-screen text-concrete-screen",
  },
} as const;

export function SourceTag({ source, surface = "paper", className }: { source: CardSource; surface?: "paper" | "screen"; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold", STYLE[surface][source], className)}>
      {LABEL[source]}
    </span>
  );
}
