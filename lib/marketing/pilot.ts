// The landing's words, and the switches for anything about real stores.
//
// - PILOT_COPY: anything from a real store's pilot: the pilot line, the table video (PILOT_MEDIA), the
//   before and after photos (BEFORE_AFTER) and the result (PILOT_RESULT). OFF until the founder has the
//   dealer's written permission; each of those also needs its own constant set before it shows.
// - PILOT_MEDIA: the founder's landscape video of a real table, right under the hero. Null until he
//   drops the files in public/pilot/ and sets it (public/pilot/README.md has the steps); until then
//   nothing renders there and the example stores follow the hero.
// - DEMO_VIDEO: a longer walkthrough of the product in "How it works", click to play. Null renders
//   nothing. Not gated: it shows the app, not a store.
// - STORE_STORY: the band right after the hero ("100 ice creams. About 5 people."), ON. TABLE_PHOTO is
//   its real table photo, shown only with PILOT_COPY on; without it the band is text only.
// - FOUNDER_STORY: the founder's own story, ON. It names streets he worked on, never a store or dealer.
// - PILOT_RESULT: the first real event's result. Null renders nothing; fill it in after the event.
export const PILOT_COPY = false;

/** One line about the pilot, shown only with PILOT_COPY on. Empty until the dealer's written permission. */
export const PILOT_LINE = "";

export const HERO = {
  eyebrow: "For Metro by T-Mobile, Cricket and Boost Mobile stores",
  /** The phone's eyebrow, short enough for one line at 320 px. */
  eyebrowShort: "For Metro, Cricket and Boost stores",
  headline: "Give your community a reason to stop.",
  /**
   * Qloo is named as what picks the music and the places, in the hero's first read. One line at every
   * width: on phones each sentence is its own block, so none paints larger than the H1 (the LCP element).
   */
  sub: ["Every prepaid store sets up the same table outside.", "Stoop uses Qloo's taste data to plan yours: music your city plays, snacks from spots nearby and a prize wheel with your deals.", "Then it makes the poster and the posts."],
  /** The Qloo line leads and says what Qloo is. */
  trust: ["Every pick backed by Qloo's taste data, with a receipt", "Built by a sales rep on a Metro floor", "Nothing posts until you approve", "Not affiliated with any carrier"],
} as const;

/** A self-hosted video: an H.264 mp4 (and an optional WebM), its first frame as a JPEG, optional captions. */
export interface LandscapeVideo {
  /** "/pilot/table.mp4", or a public Vercel Blob URL (the CSP allows both). */
  src: string;
  webm?: string | null;
  /** The first frame, shown before it plays and under reduced motion. */
  poster: string;
  /** WebVTT captions, for anything said on camera. */
  captions?: string | null;
}

/**
 * The line under the founder's video. His words: he sets them once the video is in (for example
 * "Kennesaw, GA · the first table Stoop planned"). Shown only with PILOT_MEDIA set.
 */
export const PILOT_VIDEO_CAPTION = "Kennesaw, GA · the first table Stoop planned";

/**
 * The founder's landscape video of a real table, right under the hero: 16:9, a muted loop that plays
 * inline once it scrolls into view (never under reduced motion, where it waits on its poster frame
 * with a play button). `sound: true` adds a sound button, only for a clip made with its audio kept.
 *
 * To turn it on (public/pilot/README.md has the ffmpeg command): put table.mp4 and table-poster.jpg in
 * public/pilot/, set PILOT_COPY = true above, and replace the null below with
 *
 *   { kind: "video", src: "/pilot/table.mp4", poster: "/pilot/table-poster.jpg", caption: PILOT_VIDEO_CAPTION }
 *
 * Null renders nothing: the example stores follow the hero.
 */
export type PilotMedia = LandscapeVideo & { kind: "video"; caption: string; sound?: boolean };
export const PILOT_MEDIA: PilotMedia | null = null;

/**
 * A longer walkthrough of the product, in "How it works": click to play, never autoplays. Same files
 * approach (for example /pilot/demo.mp4 and /pilot/demo-poster.jpg). Null renders nothing.
 */
export type DemoVideo = LandscapeVideo & { title: string };
export const DEMO_VIDEO: DemoVideo | null = null;

/** A real photo from the pilot, re-encoded with scripts/pilot-photo.ts (1600 px, no metadata). */
export interface PilotPhoto {
  src: string;
  alt: string;
  caption: string;
}

/**
 * Before and after, from the founder's pilot: his usual table as it normally looks, and the table
 * Stoop planned on the pilot day, side by side under the video band. An optional third image is an
 * AI preview, and always carries a visible "AI preview" label (lib/marketing/before-after.ts). Only
 * photos of people who agreed to be shown, no minors, location metadata stripped. To turn it on:
 *
 *   export const BEFORE_AFTER: BeforeAfter | null = {
 *     before: { src: "/pilot/before.jpg", alt: "...", caption: "A usual Friday table" },
 *     after: { src: "/pilot/after.jpg", alt: "...", caption: "The table Stoop planned" },
 *     preview: { src: "/pilot/preview.jpg", alt: "..." },
 *   };
 *
 * Null renders nothing (the default until he has the photos).
 */
export interface BeforeAfter {
  before: PilotPhoto;
  after: PilotPhoto;
  preview?: { src: string; alt: string } | null;
}
export const BEFORE_AFTER: BeforeAfter | null = null;

/**
 * The story band right after the hero: what happened at the founder's own store, in his words. ON, like
 * FOUNDER_STORY: it names no store or dealer. The numbers are fields, so a correction is one edit and the
 * big line and the story always agree (storyLines builds both). Set to null to take it down.
 */
export interface StoreStory {
  /** How many treats the store bought: 100. */
  bought: number;
  /** What it bought, plural: "ice creams". */
  item: string;
  /** How many people came, as said out loud: "About 5". */
  came: string;
  /** The rest of the story, after what happened. */
  lesson: string;
  credit: string;
}
export const STORE_STORY: StoreStory | null = {
  bought: 100,
  item: "ice creams",
  came: "About 5",
  lesson: "The budget wasn't the problem. Knowing what the community wants was.",
  credit: "Khadim, sales floor, Metro by T-Mobile",
};

/** The story's big line and its sentences, from its numbers: "100 ice creams. About 5 people." */
export function storyLines(story: StoreStory): { headline: string; body: string } {
  return {
    headline: `${story.bought} ${story.item}. ${story.came} people.`,
    body: `A few weeks ago, our store bought ${story.bought} ${story.item} for an event. ${story.came} people came all day. ${story.lesson}`,
  };
}

/**
 * The real table, in the story band, shown only with PILOT_COPY on (it shows a real store). Made from
 * the founder's photo: the neighbor's window cropped off the left and its last two panes frosted (beer
 * signs), then upright, 1600 px wide, JPEG quality 80 and no metadata, as scripts/pilot-photo.ts does.
 */
export const TABLE_PHOTO: (PilotPhoto & { width: number; height: number }) | null = {
  src: "/pilot/table.jpg",
  width: 1600,
  height: 1435,
  alt: "Our table outside the store: a purple canopy over a table with treats and a speaker, a sales rep behind it, and a drop board numbered 1 to 6 in front.",
  caption: "Kennesaw, GA, Oct 30, 2026: our table outside the store. Stoop is independent and isn't affiliated with T-Mobile.",
};

/** His words, as the "Built on the sales floor" quote. Set to null to take it down. */
export const FOUNDER_STORY: { quote: string; line: string; credit: string } | null = {
  quote:
    "At my first Metro store, on Tara Boulevard, a table outside with music and snacks brought in big traffic. When I moved to Kennesaw and set up the same table, people walked right past it.",
  line: "Same table, different community. Stoop plans for the community you're in.",
  credit: "Khadim, sales floor, Metro by T-Mobile",
};

/**
 * The promote section, true in both modes of ENABLE_META_POSTING (lib/config.ts metaPostingEnabled).
 * Off is the production default (share mode): Stoop writes the posts and the manager shares them.
 */
export const POSTING_COPY = {
  on: {
    title: "Approve once. Stoop lines up the posts.",
    body: "Facebook sends the announcement and reminders on schedule. Instagram posts when you approve, and WhatsApp opens your share sheet.",
    note: "Posting is on only for stores that connect their Facebook Page.",
  },
  off: {
    title: "Posts written for your channels, ready in one tap.",
    body: "An announcement and reminders for Facebook, Instagram and WhatsApp. You share each one when it's time.",
    note: "Posting straight to your Facebook Page turns on once Meta approves the app.",
  },
} as const;

/** Who it's for, one line each. */
export const WHO = [
  { title: "Store managers", line: "This Saturday's table, poster and posts, done before your shift." },
  { title: "Multi-store managers", line: "A different plan for each store, because each one sits in a different community." },
  { title: "District managers and dealer owners", line: "Every store's next event on one page." },
] as const;

/** The pilot card next to "Who it's for". */
export const PILOT_CARD = { title: "Free while we pilot.", line: "Reserve your stores and we'll set them up with you." } as const;

/** The footer's line on trademarks and what Stoop reads. */
export const FOOTER_NOTICE =
  "Metro by T-Mobile, Cricket Wireless and Boost Mobile are trademarks of their owners. Stoop is independent and isn't affiliated with or endorsed by any of them. Example stores are fictional. Stoop reads your city and the places in your community through Qloo's aggregate taste data; it never sees a shopper.";

/**
 * The first pilot's result, once it has run: for example "First pilot: X walk-ins in 3 hours, vs a
 * usual Y". Null renders nothing. Never filled in before a real event.
 */
export const PILOT_RESULT: { line: string } | null = null;

/** Always said next to a pilot result. */
export const PILOT_RESULT_LABEL = "One Friday. A first look, not proof.";
