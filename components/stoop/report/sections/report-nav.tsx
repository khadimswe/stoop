"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { REPORT_SECTIONS } from "../report-section";

/** Each link's full name (also its accessible name) and the short label phones show under 640 px. */
const LINKS = [
  { id: REPORT_SECTIONS.screening, label: "Screening Room", short: "Screening" },
  { id: REPORT_SECTIONS.kit, label: "Campaign Kit", short: "Kit" },
  { id: REPORT_SECTIONS.launch, label: "Launch plan", short: "Launch" },
  { id: REPORT_SECTIONS.why, label: "Why it works", short: "Why" },
] as const;

/** How far below the viewport's top a section counts as the one in view: the 56 px app bar, this nav, and a little air. */
const OFFSET = 132;

/**
 * The sticky section nav under the app bar: "Screening Room · Campaign Kit · Launch plan · Why it
 * works", or "Screening · Kit · Launch · Why" on phones, where the full name stays each link's
 * accessible name. It marks the section in view (aria-current="location"). If the row is still wider
 * than the screen, it scrolls sideways inside the nav (never the page) and keeps the current link in
 * view. Plain anchor jumps, no smooth scrolling; nothing is hidden behind tabs. Phones get 44 px targets.
 */
export function ReportNav() {
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

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

  // The current link scrolls into the row's view when the row overflows; only the row moves, never the page.
  useEffect(() => {
    const row = list.current;
    const link = active ? row?.querySelector<HTMLElement>(`[data-nav="${active}"]`) : null;
    if (!row || !link || row.scrollWidth <= row.clientWidth) return;
    const box = row.getBoundingClientRect();
    const target = link.getBoundingClientRect();
    // The link's place inside the row's scrolled content.
    const left = target.left - box.left + row.scrollLeft;
    if (left < row.scrollLeft || left + target.width > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.max(0, left - (row.clientWidth - target.width) / 2);
    }
  }, [active]);

  return (
    <nav aria-label="Report sections" className="sticky top-14 z-30 -mx-4 border-b border-hairline bg-paper/95 px-4 backdrop-blur sm:-mx-5 sm:px-5">
      <ul ref={list} className="flex gap-1 overflow-x-auto py-1">
        {LINKS.map((link) => {
          const current = active === link.id;
          return (
            <li key={link.id} className="shrink-0">
              <a
                href={`#${link.id}`}
                data-nav={link.id}
                aria-label={link.label}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(link.id)}
                className={cn(
                  "inline-flex h-11 items-center rounded-full px-3 text-[0.8125rem] font-semibold sm:h-9 sm:text-sm",
                  current ? "bg-ink text-paper" : "text-ink-soft hover:bg-ink/5 hover:text-ink",
                )}
              >
                <span aria-hidden="true" className="sm:hidden">
                  {link.short}
                </span>
                <span aria-hidden="true" className="hidden sm:inline">
                  {link.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
