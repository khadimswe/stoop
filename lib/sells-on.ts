// "I sell on" choices for the waitlist. A plain module, so server code (the waitlist route) can
// import it: a value exported from a "use client" file reaches the server only as a client reference.
export const SELLS_ON = [
  { value: "shopify", label: "Shopify" },
  { value: "own-site", label: "My own site" },
  { value: "amazon", label: "Amazon" },
  { value: "instagram", label: "Instagram" },
  { value: "startup", label: "I'm a startup" },
  { value: "agency", label: "I'm an agency" },
  { value: "other", label: "Other" },
] as const;
export type SellsOn = (typeof SELLS_ON)[number]["value"];
