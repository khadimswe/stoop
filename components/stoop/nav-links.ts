// Shared by the server-rendered header and the client mobile menu, so it lives in a plain module:
// a value exported from a "use client" file reaches server components only as a client reference.
export const NAV_LINKS = [
  { href: "/#examples", label: "Examples" },
  { href: "/#how", label: "How it works" },
  { href: "/judges", label: "For judges" },
] as const;
