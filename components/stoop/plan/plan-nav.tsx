import { PLAN_SECTIONS } from "./plan-section";

const LINKS = [
  { id: PLAN_SECTIONS.plan, label: "Plan" },
  { id: PLAN_SECTIONS.runOfShow, label: "Run of show" },
  { id: PLAN_SECTIONS.shopping, label: "Shopping" },
  { id: PLAN_SECTIONS.wheel, label: "Wheel" },
  { id: PLAN_SECTIONS.generic, label: "Generic AI plan" },
  { id: PLAN_SECTIONS.local, label: "City and block" },
  { id: PLAN_SECTIONS.marketing, label: "Poster and posts" },
  { id: PLAN_SECTIONS.results, label: "Results" },
] as const;

/**
 * The plan's section links under the app bar. On phones the row scrolls sideways inside the nav, never
 * the page. Plain anchor jumps, no smooth scrolling.
 */
export function PlanNav({ wheel = false }: { wheel?: boolean }) {
  return (
    <nav aria-label="Sections of this plan" className="sticky top-14 z-20 -mx-4 border-b border-hairline bg-paper/95 backdrop-blur sm:-mx-5">
      <ul className="flex gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] sm:px-4">
        {LINKS.filter((l) => wheel || l.id !== PLAN_SECTIONS.wheel).map((l) => (
          <li key={l.id} className="shrink-0">
            <a href={`#${l.id}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap text-ink-soft hover:bg-ink/5 hover:text-ink sm:min-h-9">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
