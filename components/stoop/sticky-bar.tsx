import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * The report's sticky bottom bar: the page's one brick primary. Examples get "Make this for my
 * product" (to /start); live reports pass their own action ("Email me this kit"). It is sticky, not
 * fixed, so it never covers the end of the page, and it pads for the home indicator on phones (the
 * inset applies once the viewport opts into viewport-fit=cover).
 */
export function StickyBar({
  action,
  note,
  className,
}: {
  /** Replaces the default "Make this for my product" link. Keep it one brick button. */
  action?: ReactNode;
  /** One short line next to the action, e.g. "Want this for your product?". */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 border-t border-hairline bg-surface/95 shadow-l2 backdrop-blur",
        "pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
        {note ? <p className="hidden min-w-0 text-sm text-ink-soft sm:block">{note}</p> : <span aria-hidden="true" className="hidden sm:block" />}
        {action ?? (
          <Button asChild className="w-full shrink-0 sm:w-auto">
            <Link href="/start">Make this for my product</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
