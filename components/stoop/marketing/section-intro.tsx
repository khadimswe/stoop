import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A marketing section's opening: a kicker, the display H2 (`type-h2`, marketing register only) and
 * one plain line. `id` goes on the heading so the section can be labeled by it.
 */
export function SectionIntro({
  id,
  kicker,
  title,
  lead,
  kickerTone = "soft",
  className,
}: {
  id: string;
  kicker: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  kickerTone?: "soft" | "dusk";
  className?: string;
}) {
  return (
    <div className={cn("flex max-w-[44rem] flex-col gap-3", className)}>
      <p className={cn("type-kicker", kickerTone === "dusk" ? "text-dusk" : "text-ink-soft")}>{kicker}</p>
      <h2 id={id} className="type-h2 text-balance">
        {title}
      </h2>
      {lead && <p className="type-lead text-pretty text-ink-soft">{lead}</p>}
    </div>
  );
}
