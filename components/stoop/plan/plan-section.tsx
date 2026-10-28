import type { ReactNode } from "react";
import { cn } from "cn";
import { SectionHeading } from "../section-heading";

/** The plan page's sections, in screen order. The tabs under the header point at these. */
export const PLAN_SECTIONS = {
  event: "event",
  wheel: "wheel",
  shopping: "shopping",
  posts: "posts",
  results: "results",
} as const;
export type PlanSectionId = (typeof PLAN_SECTIONS)[keyof typeof PLAN_SECTIONS];

/**
 * One section of the plan page: a landmark labeled by its heading, with a scroll margin that clears the 56 px app
 * bar and the section nav. `data-plan-section` lets tests check the order.
 */
export function PlanSection({
  id,
  title,
  kicker,
  description,
  actions,
  className,
  children,
}: {
  id: PlanSectionId;
  title: ReactNode;
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-plan-section={id} className={cn("flex scroll-mt-28 flex-col gap-4", className)}>
      <SectionHeading id={`${id}-title`} title={title} kicker={kicker} description={description} actions={actions} />
      {children}
    </section>
  );
}

/** A white app-register card on paper: hairline border, no resting shadow. */
export function Card({ className, children, as: Tag = "div" }: { className?: string; children: ReactNode; as?: "div" | "li" | "article" }) {
  return <Tag className={cn("rounded-xl border border-hairline bg-surface p-4 sm:p-5", className)}>{children}</Tag>;
}

/** Said plainly when a part has not arrived or has no data, never a blank space. */
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("rounded-xl border border-dashed border-concrete-line bg-surface px-4 py-3 text-sm text-ink-soft", className)}>{children}</p>;
}
