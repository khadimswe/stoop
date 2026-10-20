"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Stamp } from "@/components/stoop/stamp";

/**
 * A Stamp that pops once, when it scrolls into view (the section's one playful moment). It is always
 * rendered, so it reads the same without JavaScript; the pop is skipped under reduced motion by the
 * Stamp's own `motion-safe:` animation.
 */
export function StampOnView({ tone, className, children }: { tone: "qloo" | "flagged"; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className="inline-block">
      {/* The key restarts the animation when the stamp first comes into view. */}
      <Stamp key={seen ? "seen" : "waiting"} tone={tone} animate={seen} className={className}>
        {children}
      </Stamp>
    </span>
  );
}
