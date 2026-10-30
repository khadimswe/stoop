// Shared by both headers (the marketing pill and the app top bar) and the client mobile menu, so it
// lives in a plain module: a value exported from a "use client" file reaches server components only
// as a client reference. Three main places (Plan an event, My stores, Examples), plus For judges.
export const NAV_LINKS = [
  { href: "/stores", label: "My stores" },
  { href: "/#examples", label: "Examples" },
  { href: "/judges", label: "For judges" },
] as const;

/** The store form: the header's one pill. */
export const PLAN_LINK = { href: "/start", label: "Plan an event" } as const;
