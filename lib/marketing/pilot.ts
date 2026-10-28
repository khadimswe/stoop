// The landing's words, and the switches for anything about real stores.
//
// - PILOT_COPY: any pilot or dealer line. OFF until the founder has the dealer's written permission;
//   flipping it to true is the only change needed.
// - FOUNDER_STORY: the founder's own story, ON. It names streets he worked on, never a store or dealer.
// - PILOT_RESULT: the first real event's result. Null renders nothing; fill it in after the event.
export const PILOT_COPY = false;

/** One line about the pilot, shown only with PILOT_COPY on. Empty until the dealer's written permission. */
export const PILOT_LINE = "";

export const HERO = {
  headline: "Give your block a reason to stop.",
  sub: "The marketing team your store never had. Event, poster and posts, planned from your city and your block.",
} as const;

/** His words, as one quiet strip under the two posters. Set to null to take it down. */
export const FOUNDER_STORY: { quote: string; line: string; credit: string } | null = {
  quote:
    "At my first Metro store, on Tara Boulevard, a table outside with music and snacks brought in big traffic. When I moved to Kennesaw and set up the same table, people walked right past it.",
  line: "Same table, different block. Stoop plans for the block you're on.",
  credit: "Khadim, sales floor, Metro by T-Mobile",
};

/**
 * The first pilot's result, once it has run: for example "First pilot: X walk-ins in 3 hours, vs a
 * usual Y". Null renders nothing. Never filled in before a real event.
 */
export const PILOT_RESULT: { line: string } | null = null;

/** Always said next to a pilot result. */
export const PILOT_RESULT_LABEL = "One Friday. A first look, not proof.";
