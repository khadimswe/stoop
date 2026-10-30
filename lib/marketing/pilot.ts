// The landing's words, and the switches for anything about real stores.
//
// - PILOT_COPY: anything from a real store's pilot: the pilot line, the table video (PILOT_MEDIA), the
//   before and after photos (BEFORE_AFTER) and the result (PILOT_RESULT). OFF until the founder has the
//   dealer's written permission; each of those also needs its own constant set before it shows.
// - PILOT_MEDIA: the founder's landscape video of a real table, under the hero. Null until he drops the
//   files in public/pilot/ (public/pilot/README.md says which) and sets it; until then the band shows
//   the lead example store's real plan as a still.
// - DEMO_VIDEO: a longer walkthrough of the product in "How it works", click to play. Null renders
//   nothing. Not gated: it shows the app, not a store.
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
  sub: "Every prepaid store sets up the same table outside. Stoop plans yours for the community around it: music your city plays, snacks and gift cards from spots down the street, and a prize wheel built from your deals. Then it makes the poster and lines up the posts.",
  /** The phone's shorter line: the same promise in two sentences. */
  subShort: "Every prepaid store sets up the same table. Stoop plans yours for the community around it, then makes the poster and lines up the posts.",
  trust: ["Built by a sales rep on a Metro floor", "Every pick has a Qloo receipt", "Nothing posts until you approve", "Independent, not affiliated with any carrier"],
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
 * The founder's landscape video of a real table: 16:9 (1280 by 720), a muted loop that plays inline
 * once it scrolls into view, tap for sound. To turn it on, drop the files in public/pilot/ and set:
 *
 *   export const PILOT_MEDIA: PilotMedia | null = {
 *     kind: "video", src: "/pilot/table.mp4", webm: "/pilot/table.webm", poster: "/pilot/table-poster.jpg",
 *     captions: "/pilot/table.vtt", caption: PILOT_VIDEO_CAPTION,
 *   };
 *
 * Null: the band shows the lead example store's poster and what Stoop picked for its table.
 */
export type PilotMedia = LandscapeVideo & { kind: "video"; caption: string };
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
    body: "One announcement now, then reminders the evening before, the morning of and an hour before. Facebook posts go out on schedule on their own. Instagram posts when you approve. WhatsApp opens your share sheet for the groups you already have.",
    note: "Posting is on only for stores that connect their Facebook Page.",
  },
  off: {
    title: "Posts written for your channels, ready in one tap.",
    body: "Stoop writes the announcement and the reminders for the evening before, the morning of and an hour before, for Facebook, Instagram and WhatsApp. Each one is ready to copy or share in one tap, and nothing goes out without you.",
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
