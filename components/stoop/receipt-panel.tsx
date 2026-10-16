import { X } from "lucide-react";
import { Chip } from "./chip";
import { cn } from "cn";

export interface ReceiptRow {
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * One receipt, demo beat 3: the Qloo request and result behind a single cue. Gate 7 renders it inside
 * the receipts drawer from the run's Evidence; the key is never shown.
 */
export function ReceiptPanel({
  cue,
  title,
  rows,
  note = "API key never shown. Aggregate taste data, not individuals.",
  onClose,
  className,
}: {
  /** The cue this receipt backs, e.g. "Music style". */
  cue: string;
  /** What the cue says, e.g. the music style in plain words. */
  title: string;
  rows: ReceiptRow[];
  note?: string;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <aside
      aria-label={`Receipt: ${cue}`}
      className={cn("flex min-w-0 flex-col gap-4 rounded-2xl border border-hairline bg-surface p-5 shadow-l2", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <Chip origin="qloo">{cue}</Chip>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="flex size-11 items-center justify-center rounded-full border-[1.5px] border-concrete-line hover:bg-fill"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <p className="font-display text-xl leading-snug font-bold [font-stretch:90%]">{title}</p>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-ink-soft">{row.label}</dt>
            <dd className={cn("min-w-0 break-words", row.mono && "font-mono")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-hairline pt-3 text-xs text-ink-soft">{note}</p>
    </aside>
  );
}
