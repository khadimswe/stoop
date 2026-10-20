"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { REPORT_SECTIONS } from "../report-section";

const LINKS = [
  { id: REPORT_SECTIONS.screening, label: "Screening Room" },
  { id: REPORT_SECTIONS.kit, label: "Campaign Kit" },
  { id: REPORT_SECTIONS.why, label: "Why it works" },
] as const;

/** How far below the viewport's top a section counts as the one in view: the 56 px app bar, this nav, and a little air. */
const OFFSET = 132;

/**
 * The sticky section nav under the app bar: "Screening Room · Campaign Kit · Why it works". It marks
 * the section in view (aria-current="location"). Plain anchor jumps, no smooth scrolling; nothing is
 * hidden behind tabs. Phones get 44 px targets in one row.
 */
export function ReportNav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const { id } of LINKS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top - OFFSET <= 0) current = id;
      }
      // At the very end of the page the last section is the one being read, even if it is short.
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (bottom && current) current = LINKS[LINKS.length - 1].id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, []);

  return (
    <nav aria-label="Report sections" className="sticky top-14 z-30 -mx-4 border-b border-hairline bg-paper/95 px-4 backdrop-blur sm:-mx-5 sm:px-5">
      <ul className="flex gap-1 overflow-x-auto py-1">
        {LINKS.map((link) => {
          const current = active === link.id;
          return (
            <li key={link.id} className="shrink-0">
              <a
                href={`#${link.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(link.id)}
                className={cn(
                  "inline-flex h-11 items-center rounded-full px-3 text-[0.8125rem] font-semibold sm:h-9 sm:text-sm",
                  current ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
                )}
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
