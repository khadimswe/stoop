import { Chip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import type { BriefCueView } from "@/lib/report/view/output";
import { cn } from "cn";

type CueChipView = Pick<BriefCueView, "label" | "origin" | "receipt">;

/**
 * One brief cue as a chip: its origin is in the chip's color, icon and spoken label, and in visible
 * words either on the chip (`showOrigin`: "From Qloo", "Not from Qloo") or in the label of the group
 * it sits in. A Qloo-backed cue is a button that opens its receipt; a creative cue is plain text. The
 * hit area grows to about 44 px tall without moving the layout, so rows of chips stay tight.
 */
export function CueChip({ cue, surface = "paper", showOrigin = true, className }: { cue: CueChipView; surface?: "paper" | "screen"; showOrigin?: boolean; className?: string }) {
  const chip = (
    <Chip origin={cue.origin} surface={surface} showOrigin={showOrigin}>
      {cue.label}
    </Chip>
  );
  if (!cue.receipt) return <span className={cn("inline-flex max-w-full", className)}>{chip}</span>;
  return (
    <ReceiptDrawer receipt={cue.receipt}>
      <button
        type="button"
        className={cn(
          "relative inline-flex max-w-full rounded-full transition-transform after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] motion-safe:hover:-translate-y-px",
          className,
        )}
      >
        {chip}
        <span className="sr-only"> (open receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}

/**
 * A wrapping row of cue chips, with room between rows for the grown hit areas. `label` is the
 * visible group label ("From Qloo:"); with one, the chips leave out their own origin tag.
 */
export function CueChips({
  cues,
  surface = "paper",
  label,
  className,
}: {
  cues: readonly CueChipView[];
  surface?: "paper" | "screen";
  label?: string;
  className?: string;
}) {
  if (cues.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <span className={cn("text-xs", surface === "screen" ? "text-paper-dim" : "text-ink-soft")}>{label}</span>}
      <ul aria-label={label?.replace(/:$/, "")} className="flex flex-wrap items-center gap-x-1.5 gap-y-4">
        {cues.map((cue, i) => (
          <li key={`${cue.label}-${i}`} className="flex max-w-full">
            <CueChip cue={cue} surface={surface} showOrigin={!label} />
          </li>
        ))}
      </ul>
    </div>
  );
}
