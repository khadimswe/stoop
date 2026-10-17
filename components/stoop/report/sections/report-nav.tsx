import { REPORT_SECTIONS } from "../report-section";

const LINKS = [
  { id: REPORT_SECTIONS.screening, label: "Screening Room" },
  { id: REPORT_SECTIONS.kit, label: "Campaign Kit" },
  { id: REPORT_SECTIONS.why, label: "Why it works" },
] as const;

// Stub (report-bottom lane): the sticky section nav under the app bar. Next: scrollspy highlighting
// the section in view (aria-current).
export function ReportNav() {
  return (
    <nav aria-label="Report sections" className="sticky top-14 z-30 -mx-4 border-b border-hairline bg-paper/95 px-4 backdrop-blur sm:-mx-5 sm:px-5">
      <ul className="flex gap-1 overflow-x-auto py-1.5">
        {LINKS.map((link) => (
          <li key={link.id} className="shrink-0">
            <a href={`#${link.id}`} className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
