// The three example reports picked in Gate 2 (docs/data-check.md) and approved by the founder on
// Oct 16, with their fictional brand names. The lead opens the landing page. Names live here, not in
// data/candidates.json, so the frozen Control briefs (written without names) stay untouched.
export const EXAMPLES = [
  { slug: "food-hot-sauce", brandName: "Porchlight Pepper Co.", lead: true },
  { slug: "home-candles", brandName: "Lowlight Candle Co.", lead: false },
  { slug: "pets-outfits", brandName: "Whisker & Brim", lead: false },
] as const;

export type ExampleSlug = (typeof EXAMPLES)[number]["slug"];

export const LEAD_EXAMPLE = EXAMPLES.find((e) => e.lead) as (typeof EXAMPLES)[number];
