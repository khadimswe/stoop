import type { ReactNode } from "react";
import { BadgeCheck, CircleSlash, Flag, CircleHelp, PenLine, UserRound, Waypoints } from "lucide-react";
import { Chip, SeedChip, type SeedOrigin } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import type { ReceiptView } from "@/lib/report/view/types";
import type { CueOrigin } from "@/lib/types";
import { cn } from "cn";

/**
 * Text that opens its receipt (a number, a measured line). Dusk underline: Qloo decided this. Without
 * a receipt it is plain text, never a dead link.
 */
export function ReceiptLink({ receipt, children, className }: { receipt: ReceiptView | null; children: ReactNode; className?: string }) {
  if (!receipt) return <span className={className}>{children}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button
        type="button"
        className={cn(
          "inline rounded-sm text-left underline decoration-dusk decoration-[1.5px] underline-offset-[3px] hover:decoration-2 hover:decoration-ink",
          className,
        )}
      >
        {children}
        <span className="sr-only"> (opens its receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}

/** What each cue origin says in full, next to the cue (creative cues spell out "not from Qloo"). */
export const ORIGIN_WORDS: Readonly<Record<CueOrigin, string>> = {
  qloo: "Qloo",
  interpreted: "From Qloo",
  creative: "Creative suggestion (not from Qloo)",
  yours: "Your choice",
};

/** A cue's origin chip; it opens the cue's receipt when there is one. */
export function OriginChip({ origin, receipt, label, className }: { origin: CueOrigin; receipt: ReceiptView | null; label?: string; className?: string }) {
  const chip = <Chip origin={origin}>{label ?? ORIGIN_WORDS[origin]}</Chip>;
  if (!receipt) return <span className={cn("inline-flex max-w-full", className)}>{chip}</span>;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button type="button" className={cn("inline-flex max-w-full rounded-full", className)}>
        {chip}
        <span className="sr-only"> (opens the receipt for {receipt.cue})</span>
      </button>
    </ReceiptDrawer>
  );
}

/** A seed chip that opens its receipt. */
export function SeedReceipt({ origin, name, kind, receipt }: { origin: SeedOrigin; name: string; kind: string; receipt: ReceiptView | null }) {
  const chip = <SeedChip origin={origin} name={name} kind={kind} />;
  if (!receipt) return chip;
  return (
    <ReceiptDrawer receipt={receipt}>
      <button type="button" className="inline-flex max-w-full rounded-full">
        {chip}
        <span className="sr-only"> (opens its receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}

const TAG_STYLE = {
  qloo: { icon: BadgeCheck, className: "border-dusk bg-dusk text-paper" },
  interpreted: { icon: Waypoints, className: "border-dusk bg-surface text-dusk" },
  flagged: { icon: Flag, className: "border-rose-deep bg-rose-soft text-rose-deep" },
  none: { icon: CircleSlash, className: "border-dashed border-concrete-line bg-surface text-ink-soft" },
  unknown: { icon: CircleHelp, className: "border-dashed border-concrete-line bg-surface text-ink-soft" },
  creative: { icon: PenLine, className: "border-dashed border-concrete-line bg-surface text-ink-soft" },
  you: { icon: UserRound, className: "border-ink bg-surface text-ink" },
} as const;

/**
 * A small status tag whose visible words carry the meaning (so it needs no hidden label): dusk for
 * what Qloo supports, rose for "Cliche flagged", dashed concrete for what Qloo could not score.
 */
export function StatusTag({ tone, children, className }: { tone: keyof typeof TAG_STYLE; children: ReactNode; className?: string }) {
  const { icon: Icon, className: style } = TAG_STYLE[tone];
  return (
    <span className={cn("inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 text-xs leading-tight font-semibold", style, className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

/** One agent decision from the trace: what it decided, and why, in its own words. */
export function TraceDecisions({ steps, title = "Agent decisions", className }: { steps: { label: string; reason: string | null }[]; title?: string; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="font-mono text-[0.6875rem] font-medium tracking-wide text-ink-soft uppercase">{title}</p>
      <ol className="flex flex-col gap-1.5 border-l-2 border-hairline pl-3">
        {steps.map((step, i) => (
          <li key={`${i}-${step.label}`} className="flex flex-col gap-0.5">
            <span className="text-sm leading-snug">{step.label}</span>
            {step.reason && <span className="text-xs leading-snug text-ink-soft">{step.reason}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
