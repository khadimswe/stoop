"use client";

import { useEffect } from "react";

/**
 * Runs the landing's scroll reveals (see reveal.ts): one observer for every `[data-reveal]` block.
 * Blocks on screen or above it at load are left alone, so nothing visible ever blinks out; blocks
 * below the fold are hidden out of sight, then fade and rise in once. Renders nothing. Does nothing
 * without IntersectionObserver or under reduced motion, where every block stays as the server drew it.
 */
export function ScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal='idle']")).filter((node) => node.getBoundingClientRect().top >= window.innerHeight);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      // Starts once a block's top is a little way into the viewport.
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const node of below) {
      node.dataset.reveal = "pending";
      observer.observe(node);
    }
    return () => {
      observer.disconnect();
      // Leaving (or a remount in development): never leave a block hidden behind.
      for (const node of below) if (node.dataset.reveal === "pending") node.dataset.reveal = "idle";
    };
  }, []);
  return null;
}
