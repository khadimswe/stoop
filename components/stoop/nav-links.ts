// Shared by both headers (the marketing pill and the app top bar) and the client mobile menu, so it
// lives in a plain module: a value exported from a "use client" file reaches server components only
// as a client reference.
export const NAV_LINKS = [
  { href: "/#examples", label: "Examples" },
  { href: "/#how", label: "How it works" },
  { href: "/judges", label: "For judges" },
] as const;

/** The text link to the live agent, next to the waitlist pill. */
export const TRY_LINK = { href: "/start", label: "Try it free" } as const;
