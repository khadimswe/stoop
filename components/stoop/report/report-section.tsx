import type { ReactNode } from "react";
import { cn } from "cn";
import { SectionHeading } from "../section-heading";

/** The report's section ids, in screen order. The sticky nav and in-page links point at these. */
export const REPORT_SECTIONS = {
  reality: "reality",
  yourAd: "your-ad",
  output: "output",
  screening: "screening",
  kit: "kit",
  why: "why",
} as const;
export type ReportSectionId = (typeof REPORT_SECTIONS)[keyof typeof REPORT_SECTIONS];

/**
 * One report section: a landmark labeled by its heading, with a scroll margin that clears the 56 px
 * app bar and the sticky section nav. `data-report-section` lets tests check the order.
 */
export function ReportSection({
  id,
  title,
  kicker,
  description,
  actions,
  className,
  children,
}: {
  id: ReportSectionId;
  title: ReactNode;
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-report-section={id} className={cn("flex scroll-mt-28 flex-col gap-4", className)}>
      <SectionHeading id={`${id}-title`} title={title} kicker={kicker} description={description} actions={actions} />
      {children}
    </section>
  );
}
