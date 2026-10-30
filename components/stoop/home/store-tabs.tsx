"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";

export interface StoreTab {
  slug: string;
  storeName: string;
  city: string;
}

/**
 * The three example stores as tabs: arrow keys move between them (roving tabindex), Home and End
 * jump to the ends, and the panel follows the focused tab. The first tab's panel is in the HTML, so
 * it reads without JavaScript; the others are server-rendered into the payload and mount when picked,
 * so the page carries one store's words and one map at a time.
 */
export function StoreTabs({ tabs, panels, label }: { tabs: readonly StoreTab[]; panels: readonly ReactNode[]; label: string }) {
  const [at, setAt] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const next = (i + tabs.length) % tabs.length;
    setAt(next);
    refs.current[next]?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    const moves: Record<string, () => void> = { ArrowRight: () => go(at + 1), ArrowDown: () => go(at + 1), ArrowLeft: () => go(at - 1), ArrowUp: () => go(at - 1), Home: () => go(0), End: () => go(tabs.length - 1) };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-2 sm:gap-3">
        {tabs.map((tab, i) => {
          const on = i === at;
          return (
            <button
              key={tab.slug}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.slug}`}
              aria-selected={on}
              aria-controls={on ? `panel-${tab.slug}` : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => setAt(i)}
              className={cn(
                "flex min-h-11 min-w-0 items-center rounded-full border px-4 text-left text-sm font-semibold transition-colors motion-reduce:transition-none sm:flex-1 sm:flex-col sm:items-start sm:justify-center sm:rounded-[12px] sm:py-3 lg:flex-none",
                on ? "border-fl-ink bg-fl-ink text-white sm:border-2 sm:bg-white sm:px-[15px] sm:text-fl-ink" : "border-fl-line bg-white text-fl-ink hover:border-fl-ink",
              )}
            >
              {/* Phones show the city alone; wider, the store's name with its city under it. */}
              <span className="hidden w-full truncate text-[0.9375rem] sm:block">{tab.storeName}</span>
              <span className="sm:block sm:w-full sm:truncate sm:text-xs sm:font-normal sm:text-fl-dim">{tab.city}</span>
            </button>
          );
        })}
      </div>
      {/* Only the picked store's panel is in the page (its map included); the others mount when picked. */}
      {tabs.map((tab, i) =>
        i === at ? (
          <div key={tab.slug} role="tabpanel" id={`panel-${tab.slug}`} aria-labelledby={`tab-${tab.slug}`}>
            {panels[i]}
          </div>
        ) : null,
      )}
    </div>
  );
}
