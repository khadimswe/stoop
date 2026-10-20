import { BadgeCheck, Flag, Lightbulb, PenLine, UserRound, Waypoints, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { CueOrigin } from "@/lib/types";

/**
 * Evidence chips. Color is never the only signal: every origin also has an icon and a spoken label.
 *   qloo         Qloo returned this for this audience (solid dusk)
 *   interpreted  LLM wording that cites Qloo items (outlined dusk)
 *   creative     Not from Qloo: a creative suggestion (dashed concrete)
 *   yours        The user chose it (outlined ink: no new color meaning)
 *   flagged      Cliche or unsupported (rose)
 */
export type ChipOrigin = CueOrigin | "flagged";

const ORIGIN = {
  qloo: { icon: BadgeCheck, spoken: "From Qloo", tag: "Qloo" },
  interpreted: { icon: Waypoints, spoken: "Interpreted from Qloo data", tag: "From Qloo" },
  creative: { icon: PenLine, spoken: "Creative suggestion, not from Qloo", tag: "Not from Qloo" },
  yours: { icon: UserRound, spoken: "Your choice", tag: "Your choice" },
  flagged: { icon: Flag, spoken: "Flagged: not supported by Qloo", tag: "Flagged" },
} as const;

const STYLE = {
  paper: {
    qloo: "border-dusk bg-dusk text-paper",
    interpreted: "border-dusk bg-paper-raised text-dusk",
    creative: "border-dashed border-concrete-line bg-paper-raised text-ink-soft",
    yours: "border-ink bg-paper-raised text-ink",
    flagged: "border-rose-deep bg-rose-soft text-rose-deep",
  },
  screen: {
    qloo: "border-dusk-light bg-dusk-light text-screen",
    interpreted: "border-dusk-light bg-transparent text-dusk-light",
    creative: "border-dashed border-concrete-screen bg-transparent text-concrete-screen",
    yours: "border-paper bg-transparent text-paper",
    flagged: "border-rose-light bg-transparent text-rose-light",
  },
} as const;

export function Chip({
  origin,
  surface = "paper",
  showOrigin = false,
  className,
  children,
}: {
  origin: ChipOrigin;
  surface?: "paper" | "screen";
  /** Prints the origin tag inside the chip, e.g. "Not from Qloo". */
  showOrigin?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { icon: Icon, spoken, tag } = ORIGIN[origin];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[0.8125rem] leading-none font-semibold",
        STYLE[surface][origin],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{spoken}: </span>
      <span className="truncate">{children}</span>
      {showOrigin && (
        <span aria-hidden="true" className="font-mono text-[0.6875rem] font-medium">
          · {tag}
        </span>
      )}
    </span>
  );
}

/**
 * Seed chips: where an input came from. Separate from cue origins, which describe outputs.
 *   qloo       a tag Qloo returned for the product description (solid dusk)
 *   suggested  proposed by Stoop, shown only after Qloo search returned a matching name (outlined)
 *   you        added by the user through Qloo autocomplete (outlined ink)
 */
export type SeedOrigin = "qloo" | "suggested" | "you";

const SEED = {
  qloo: { icon: BadgeCheck, tag: "Qloo", spoken: "Qloo tag from your page", style: "border-dusk bg-dusk text-paper" },
  suggested: {
    icon: Lightbulb,
    tag: "Suggested",
    spoken: "Suggested by Stoop and confirmed in Qloo",
    style: "border-concrete-line bg-surface text-ink",
  },
  you: { icon: UserRound, tag: "You", spoken: "Added by you", style: "border-ink bg-surface text-ink" },
} as const;

export function SeedChip({
  origin,
  name,
  kind,
  onRemove,
  className,
}: {
  origin: SeedOrigin;
  name: string;
  /** Qloo type in plain words, e.g. "brand", "tv", "tag". */
  kind: string;
  onRemove?: () => void;
  className?: string;
}) {
  const { icon: Icon, tag, spoken, style } = SEED[origin];
  return (
    <span
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border-[1.5px] pl-2.5 text-[0.8125rem] font-semibold",
        onRemove ? "pr-1" : "pr-3",
        style,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
      <span className="font-mono text-[0.6875rem] font-medium whitespace-nowrap">
        {kind} · <span className="sr-only">{spoken}</span>
        <span aria-hidden="true">{tag}</span>
      </span>
      {onRemove && (
        // 24 px to see, 44 px to tap: the pseudo-element widens the hit area without moving the chip.
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="relative ml-0.5 flex size-6 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-2.5 after:content-[''] hover:bg-ink/10"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}
