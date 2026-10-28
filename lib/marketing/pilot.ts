// Real-store and pilot copy, behind ONE switch. It stays off until the founder has written permission
// from the dealer and has approved the wording; flipping PILOT_COPY to true is the only change needed.
// With it off, the landing tells the product's story with the fictional example stores only.
export const PILOT_COPY = false;

/** The founder's story, for the landing hero when PILOT_COPY is on. His words; keep them plain. */
export const FOUNDER_HERO = {
  headline: "The table worked on Tara Boulevard. In Kennesaw, people walked right past it.",
  sub: "The table wasn't the problem. Knowing the block was. Stoop plans the event this block wants.",
  line: "Marketing isn't just for big companies.",
} as const;

/** The landing hero with the pilot copy off. */
export const DEFAULT_HERO = {
  headline: "Give your block a reason to stop.",
  sub: "Your store's event, planned from your city's music and the spots on your block.",
} as const;

/** One line about the pilot, shown only with PILOT_COPY on. */
export const PILOT_LINE = "Piloting at two JM Wireless stores, a Metro by T-Mobile authorized dealer.";
