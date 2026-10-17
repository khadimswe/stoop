import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * An app-register section title: Bricolage at 24 px (nothing over 32 px inside the app), an optional
 * kicker above and one plain line below, with actions (text buttons) on the right from sm up.
 * `id` goes on the heading, so `aria-labelledby` and in-page links can point at it.
 */
export function SectionHeading({
  id,
  title,
  kicker,
  description,
  actions,
  as: Heading = "h2",
  className,
}: {
  id?: string;
  title: ReactNode;
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {kicker && <p className="type-kicker text-ink-soft">{kicker}</p>}
        <Heading
          id={id}
          className={cn(
            "font-display leading-tight font-extrabold tracking-tight text-balance [font-stretch:85%]",
            Heading === "h2" ? "text-2xl" : "text-xl",
          )}
        >
          {title}
        </Heading>
        {description && <p className="max-w-[60ch] text-sm text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
    </div>
  );
}
