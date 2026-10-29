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
  eyebrow: "For prepaid wireless stores",
  headline: "Give your community a reason to stop.",
  sub: "Stoop plans the table outside your store from what your city plays and the spots in your community. Then it makes the poster and posts it, once you approve.",
  note: "Built by a sales rep who works the floor at a prepaid wireless store, with Qloo's taste data for your city and the places in your community.",
} as const;

/**
 * The hero's media: the founder's real event, once he approves it. A video (muted loop, tap for
 * sound, a poster frame first, captions) or up to three photos. Null: the lead example's poster.
 */
export const PILOT_MEDIA:
  | { kind: "video"; src: string; poster: string; captions: string | null; caption: string }
  | { kind: "photos"; photos: { src: string; alt: string }[]; caption: string }
  | null = null;

/** His words, as one quiet strip under the two posters. Set to null to take it down. */
export const FOUNDER_STORY: { quote: string; line: string; credit: string } | null = {
  quote:
    "At my first Metro store, on Tara Boulevard, a table outside with music and snacks brought in big traffic. When I moved to Kennesaw and set up the same table, people walked right past it.",
  line: "Same table, different community. Stoop plans for the community you're in.",
  credit: "Khadim, sales floor, Metro by T-Mobile",
};

/**
 * The first pilot's result, once it has run: for example "First pilot: X walk-ins in 3 hours, vs a
 * usual Y". Null renders nothing. Never filled in before a real event.
 */
export const PILOT_RESULT: { line: string } | null = null;

/** Always said next to a pilot result. */
export const PILOT_RESULT_LABEL = "One Friday. A first look, not proof.";
