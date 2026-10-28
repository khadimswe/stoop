// The example stores, as data only (no file reads), so any page or component can import it. The
// three fictional stores sit at real addresses on busy commercial streets in three cities with
// clearly different taste; they carry the carrier as text ("metro") and say plainly that they are not
// affiliated with it. Offers are worded the way a manager types them. The recorded runs live in
// data/plans/<slug>/ (lib/plan/examples.ts reads them) and are never rewritten once approved.
//
// Adding a store (a real one needs the dealer's written permission first): one entry in
// PLAN_EXAMPLES with `fictional: false`, its inputs in PLAN_EXAMPLE_INPUTS, then one run of
// `npx tsx scripts/record-plan-example.ts <slug>`.
import type { PlanInputs } from "./schema";

export const PLAN_EXAMPLES = [
  { slug: "chicago-18th-street", storeName: "18th Street Wireless", city: "Chicago", lead: true, fictional: true },
  { slug: "atlanta-west-end", storeName: "West End Wireless", city: "Atlanta", lead: false, fictional: true },
  { slug: "houston-east-end", storeName: "Navigation Wireless", city: "Houston", lead: false, fictional: true },
] as const;

export type PlanExampleSlug = (typeof PLAN_EXAMPLES)[number]["slug"];
export type PlanExample = (typeof PLAN_EXAMPLES)[number];

export const LEAD_PLAN_EXAMPLE = PLAN_EXAMPLES.find((e) => e.lead) as PlanExample;

/**
 * What /start fills in before the manager changes anything. A store's real event budget is small
 * (about $50: snacks plus one or two small gift cards), so that is the default.
 */
export const PLAN_DEFAULTS = { budgetUsd: 50, startTime: "12:00", durationMinutes: 180, setting: "sidewalk_table" } as const satisfies Partial<PlanInputs>;

/** Shown next to every fictional example store. */
export const EXAMPLE_DISCLAIMER = "A fictional store, for illustration. Not affiliated with T-Mobile.";
/** Shown next to a real store's example, which is published only with the dealer's written permission. */
export const REAL_STORE_NOTE = "Shared with the store's permission. Stoop is not affiliated with T-Mobile.";

/** The line to show under an example store. */
export const exampleNote = (example: { fictional: boolean }) => (example.fictional ? EXAMPLE_DISCLAIMER : REAL_STORE_NOTE);

/** An example's plan id: "ex-<slug>". Accepted everywhere a plan id is. */
export const examplePlanId = (slug: PlanExampleSlug) => `ex-${slug}`;

/** The example a plan id names, if it is one of the shipped examples. */
export function planExampleSlug(planId: string): PlanExampleSlug | null {
  const slug = /^ex-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(planId)?.[1];
  return PLAN_EXAMPLES.find((e) => e.slug === slug)?.slug ?? null;
}

/** Where the UI shows an example plan. */
export const examplePlanPath = (slug: PlanExampleSlug) => `/examples/stores/${slug}`;

/** What each example was recorded with: the inputs a manager would type on /start. */
export const PLAN_EXAMPLE_INPUTS: Record<PlanExampleSlug, PlanInputs> = {
  "chicago-18th-street": {
    store: {
      id: "chicago-18th-street",
      name: "18th Street Wireless",
      carrier: "metro",
      address: "1240 W 18th St, Chicago, IL 60608",
      city: "Chicago",
      region: "IL",
      point: { lat: 41.8576, lon: -87.6566 },
    },
    date: "2026-11-07",
    startTime: "12:00",
    durationMinutes: 240,
    setting: "sidewalk_table",
    budgetUsd: 50,
    offers: [
      { text: "$25/mo unlimited when you switch, taxes and fees included" },
      { text: "Free 5G phone when you port in your number (select models)" },
      { text: "Free tablet with a new line" },
    ],
    ageBands: ["25_to_29", "30_to_34"],
    notes: "One folding table, one speaker and the prize wheel, two of us on staff. It will be cold out, so something warm would help.",
  },
  "atlanta-west-end": {
    store: {
      id: "atlanta-west-end",
      name: "West End Wireless",
      carrier: "metro",
      address: "870 Ralph David Abernathy Blvd SW, Atlanta, GA 30310",
      city: "Atlanta",
      region: "GA",
      point: { lat: 33.7378, lon: -84.414 },
    },
    date: "2026-11-14",
    startTime: "13:00",
    durationMinutes: 240,
    setting: "sidewalk_table",
    budgetUsd: 75,
    offers: [{ text: "2 lines for $50/mo with autopay" }, { text: "Bring your own phone, first month free" }, { text: "Free phone when you switch (select models)" }],
    ageBands: ["24_and_younger", "25_to_29"],
    notes: "Foot traffic picks up after 2 pm when people come off the train. Needs to be quick to set up and break down.",
  },
  "houston-east-end": {
    store: {
      id: "houston-east-end",
      name: "Navigation Wireless",
      carrier: "metro",
      address: "2810 Navigation Blvd, Houston, TX 77003",
      city: "Houston",
      region: "TX",
      point: { lat: 29.7562, lon: -95.3436 },
    },
    date: "2026-11-21",
    startTime: "11:00",
    durationMinutes: 300,
    setting: "community_event",
    location: { name: "a fall community fair on Navigation Blvd", point: { lat: 29.7566, lon: -95.3422 } },
    budgetUsd: 50,
    offers: [{ text: "Free tablet with a new line" }, { text: "$30/mo unlimited, no annual contract" }],
    ageBands: ["30_to_34", "35_to_44"],
    notes: "We got a booth at the fair two blocks from the store. Snacks, not catering, and a couple of small gift cards.",
  },
};
