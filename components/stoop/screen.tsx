import type { ComponentProps } from "react";
import { cn } from "cn";

/**
 * A dark "screening room" screen: an object sitting on the paper page, never the page itself.
 * - stage: the landing's TV, with an ink border and the hard sticker shadow (marketing register).
 * - app: the calm version inside reports and the theater: no border, no shadow (app register).
 * `data-surface="screen"` re-maps semantic colors for any component placed inside.
 */
export function Screen({ variant = "stage", className, ...props }: ComponentProps<"div"> & { variant?: "stage" | "app" }) {
  return (
    <div
      data-surface="screen"
      className={cn(
        // The outline sits on paper, but data-surface remaps --ring for the inside, so pin a paper-safe color.
        "bg-screen text-paper focus-visible:outline-dusk",
        variant === "stage" ? "rounded-card border-[3px] border-ink shadow-sticker" : "rounded-2xl",
        className,
      )}
      {...props}
    />
  );
}
