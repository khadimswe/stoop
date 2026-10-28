import { PLAN_SECTIONS } from "./plan-section";

const LINKS = [
  { id: PLAN_SECTIONS.event, label: "Event" },
  { id: PLAN_SECTIONS.wheel, label: "Wheel" },
  { id: PLAN_SECTIONS.shopping, label: "Shopping" },
  { id: PLAN_SECTIONS.posts, label: "Posts" },
  { id: PLAN_SECTIONS.results, label: "Results" },
] as const;

/**
 * The plan's sections as a row of anchors under the app bar: Event, Wheel, Shopping, Posts, Results.
 * Wheel shows only when the plan has one. Plain anchor jumps, no smooth scrolling.
 */
export function PlanNav({ wheel = false }: { wheel?: boolean }) {
  return (
    <nav aria-label="Sections of this plan" className="sticky top-14 z-20 -mx-4 border-b border-hairline bg-paper/95 backdrop-blur sm:-mx-5">
      <ul className="flex overflow-x-auto px-2 [scrollbar-width:none] sm:gap-1 sm:px-4">
        {LINKS.filter((l) => wheel || l.id !== PLAN_SECTIONS.wheel).map((l) => (
          <li key={l.id} className="shrink-0">
            <a href={`#${l.id}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-ink-soft hover:bg-ink/5 hover:text-ink">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
