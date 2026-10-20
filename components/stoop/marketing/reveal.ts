// Scroll reveals for the landing, as progressive enhancement. A revealable block is server-rendered
// visible (`data-reveal="idle"`). Only once JavaScript runs and motion is allowed does ScrollReveal mark
// the blocks still below the fold "pending" (faded and lowered, out of sight), then "shown" as each one
// enters the viewport, once. Without JavaScript, or with reduced motion, nothing is ever hidden.
// A plain module (no "use client"), so server components can spread these props.

/** The fade and rise, keyed on the attribute ScrollReveal sets. */
export const REVEAL_CLASS =
  "transition-[opacity,translate] duration-700 ease-smooth data-[reveal=pending]:translate-y-8 data-[reveal=pending]:opacity-0";

/** Spread on a block that fades and rises in once. `delay` staggers siblings (ms). */
export function reveal(delay = 0): { "data-reveal": "idle"; style?: { transitionDelay: string } } {
  return delay > 0 ? { "data-reveal": "idle", style: { transitionDelay: `${delay}ms` } } : { "data-reveal": "idle" };
}
