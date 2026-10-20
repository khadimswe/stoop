import { Chip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { cueKeyOf } from "@/lib/report/view/deep-link";
import type { BriefCueView } from "@/lib/report/view/output";
import { cn } from "cn";

type CueChipView = Pick<BriefCueView, "label" | "origin" | "receipt"> & { slot?: BriefCueView["slot"] };

/**
 * One brief cue as a chip: its origin is in the chip's color, icon and spoken label, and in visible
 * words either on the chip (`showOrigin`: "From Qloo", "Not from Qloo") or in the label of the group
 * it sits in. A Qloo-backed cue is a button that opens its receipt; a creative cue is plain text. The
 * hit area grows to 44 px tall (not wider, so neighbors never share one) without moving the layout.
 * `deepLink`: the chip answers "#receipt-<cue>" links (the Screening Room's rows set it).
 */
export function CueChip({
  cue,
  surface = "paper",
  showOrigin = true,
  deepLink = false,
  className,
}: {
  cue: CueChipView;
  surface?: "paper" | "screen";
  showOrigin?: boolean;
  deepLink?: boolean;
  className?: string;
}) {
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
        data-receipt-cue={deepLink && cue.slot ? cueKeyOf(cue.slot) : undefined}
        className={cn(
          "relative inline-flex max-w-full rounded-full transition-transform after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] motion-safe:hover:-translate-y-px",
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
 * A wrapping row of cue chips, with room between rows for the grown hit areas (rows 20 px apart, so
 * 44 px areas touch but never overlap). `label` is the visible group label ("From Qloo:"); with one,
 * the chips leave out their own origin tag.
 */
export function CueChips({
  cues,
  surface = "paper",
  label,
  deepLinks = false,
  className,
}: {
  cues: readonly CueChipView[];
  surface?: "paper" | "screen";
  label?: string;
  deepLinks?: boolean;
  className?: string;
}) {
  if (cues.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <span className={cn("text-xs", surface === "screen" ? "text-paper-dim" : "text-ink-soft")}>{label}</span>}
      <ul aria-label={label?.replace(/:$/, "")} className="flex flex-wrap items-center gap-x-1.5 gap-y-5">
        {cues.map((cue, i) => (
          <li key={`${cue.label}-${i}`} className="flex max-w-full">
            <CueChip cue={cue} surface={surface} showOrigin={!label} deepLink={deepLinks} />
          </li>
        ))}
      </ul>
    </div>
  );
}
