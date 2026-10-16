import { cn } from "cn";

/** Four steps of a stoop. Same mark as app/icon.svg. */
export function StoopMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        d="M8 22h16M10 18h12M12 14h8M14 10h4"
        stroke="var(--color-paper)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <StoopMark />
      <span className="font-display text-[1.4rem] font-extrabold tracking-tight [font-stretch:85%]">Stoop</span>
    </span>
  );
}
