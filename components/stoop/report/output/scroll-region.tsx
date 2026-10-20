"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A labeled region that scrolls sideways on narrow screens. It is a tab stop (so keyboard users can
 * scroll it) only while its content overflows; where it lays out without scrolling, it is not.
 */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} role="region" aria-label={label} tabIndex={scrolls ? 0 : undefined} className={className}>
      {children}
    </div>
  );
}
