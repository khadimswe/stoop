// The landing's words, and the switches for anything about real stores.
//
// - PILOT_COPY: anything from a real store's pilot: the pilot line, the table video (PILOT_MEDIA), the
//   real table section (TABLE_PHOTO and PILOT_RESULT) and the before and after photos (BEFORE_AFTER).
//   ON since Oct 30: the founder confirmed in writing that his manager, his coworkers and everyone
//   pictured agreed. Each of those also needs its own constant set before it shows.
// - PILOT_MEDIA: the founder's landscape video of a real table, right under the hero. Null until he
//   drops the files in public/pilot/ and sets it (public/pilot/README.md has the steps); until then
//   nothing renders there and the example stores follow the hero.
// - DEMO_VIDEO: a longer walkthrough of the product in "How it works", click to play. Null renders
//   nothing. Not gated: it shows the app, not a store.
// - STORE_STORY: the founder's story, the band right after the hero ("Going outside works. Guessing
//   doesn't."), ON. It names no store or dealer, and never carries a photo.
// - TABLE_PHOTO: the real table section after the story, "The first table Stoop planned", with
//   PILOT_RESULT and its label under it (null renders nothing).
export const PILOT_COPY = true;

/** One line about the pilot, shown only with PILOT_COPY on. Empty until the dealer's written permission. */
export const PILOT_LINE = "";

export const HERO = {
  /** Who it's for; the carriers are named only here and in the footer's trademark line. */
  eyebrow: "For Metro by T-Mobile, Cricket and Boost stores",
  /** Three short sentences, each starting its own line: the experience before the product. */
  headline: ["The music they love.", "The food down the street.", "A table they stop for."],
  /** One sentence: Qloo reads the community, Stoop plans the event and makes what promotes it. */
  sub: "Stoop reads the community around your store with Qloo's taste data, plans your next event around it, then makes the poster and the posts.",
  /** Under the first screen, one row: the Qloo line leads. */
  trust: ["Every pick backed by Qloo's taste data", "Built by a sales rep on a Metro floor", "Nothing posts until you approve"],
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

/** The chip on the founder's video in the hero, next to its "How it went" link to the real table section. */
export const PILOT_VIDEO_CAPTION = "Kennesaw, GA, Oct 30: the first table Stoop planned";

/**
 * The founder's landscape video of the first table Stoop planned, in the hero (beside the words on
 * desktop, under the buttons on phones): 16:9, a muted loop that plays inline once in view (never under
 * reduced motion, where it waits on its poster frame with a play button). `sound: true` adds a sound
 * button, only for a clip made with its audio kept. public/pilot/README.md has the ffmpeg command.
 * Shown only with PILOT_COPY on; null renders nothing and the hero is the words alone.
 */
export type PilotMedia = LandscapeVideo & { kind: "video"; caption: string; sound?: boolean };
export const PILOT_MEDIA: PilotMedia | null = { kind: "video", src: "/pilot/table.mp4", poster: "/pilot/table-poster.jpg", caption: PILOT_VIDEO_CAPTION };

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
 * The story band right after the hero (after the video, when one is set): the founder's story, in his
 * words. ON: it names no store or dealer. It never carries a photo, so no picture reads as the event it
 * tells. The numbers are fields, so a correction is one edit (storyLines puts the sentence together).
 * Set to null to take it down.
 */
export interface StoreStory {
  headline: string;
  /** The story up to the numbers, ending "..., and". */
  before: string;
  /** How many treats the store bought: 100. */
  bought: number;
  /** What it bought, plural: "ice creams". */
  item: string;
  /** How many people came, as said out loud: "about 5". */
  came: string;
  /** The rest of the story, after the numbers. */
  after: string;
  credit: string;
}
export const STORE_STORY: StoreStory | null = {
  headline: "Going outside works. Guessing doesn't.",
  before:
    "Selling phones at a prepaid store is hard. A table outside helps, but only when it fits the community. At my first store I knew my regulars, and it worked. In Kennesaw the same table got walked past, and",
  bought: 100,
  item: "ice creams",
  came: "about 5",
  after: "The budget wasn't the problem. Knowing the community was.",
  credit: "Khadim, sales floor, Metro by T-Mobile",
};

/** The story's big line and its text, the numbers filled in: "..., and 100 ice creams drew about 5 people." */
export function storyLines(story: StoreStory): { headline: string; body: string } {
  return { headline: story.headline, body: `${story.before} ${story.bought} ${story.item} drew ${story.came} people. ${story.after}` };
}

/**
 * The real table section after the story, "The first table Stoop planned", shown only with PILOT_COPY
 * on (it shows a real store). Taken Oct 30 at the table Stoop planned, never the ice cream event. Made
 * from the founder's photo with its left edge cropped, unretouched, then upright, 1600 px wide, JPEG
 * quality 80 and no metadata, as scripts/pilot-photo.ts does.
 */
export const TABLE_PHOTO: (PilotPhoto & { width: number; height: number }) | null = {
  src: "/pilot/table.jpg",
  width: 1600,
  height: 1435,
  alt: "Our table outside the store: a purple canopy over a table with treats and a speaker, a sales rep behind it, and a drop board numbered 1 to 6 in front.",
  caption: "Kennesaw, GA, Oct 30, 2026: the table Stoop planned, outside our store. Stoop is independent and isn't affiliated with T-Mobile.",
};

/** The real table section's heading, where the video chip's "How it went" link lands. */
export const TABLE_TITLE = "How it went.";

/**
 * A real snapshot from the ice cream day, beside the story it tells, shown only with PILOT_COPY on. The
 * founder's photo of the shaved-ice truck that served it, cropped so the owners' names and phone number
 * are out of frame, no metadata. Small (it's 300 by 440). The truck's company is never named in text.
 */
export const STORY_PHOTO: (PilotPhoto & { width: number; height: number }) | null = {
  src: "/pilot/ice-cream-day.jpg",
  width: 300,
  height: 440,
  alt: "A shaved-ice truck parked at the curb on the ice cream day.",
  caption: "The ice cream day, a few weeks ago. The truck was great. Our guess about the community wasn't.",
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
    body: "For Facebook, Instagram and WhatsApp.",
    note: "Direct Facebook posting turns on once Meta approves.",
  },
} as const;

/** Who it's for, one line each. */
export const WHO = [
  { title: "Store managers", line: "This Saturday's table, poster and posts." },
  { title: "Multi-store managers", line: "A plan fit to each store's community." },
  { title: "District managers and dealer owners", line: "Every store's next event on one page." },
] as const;

/** The pilot card next to "Who it's for". */
export const PILOT_CARD = { title: "Free while we pilot.", line: "Reserve your stores and we'll set them up with you." } as const;

/** The footer's line on trademarks and what Stoop reads. */
export const FOOTER_NOTICE =
  "Metro by T-Mobile, Cricket Wireless and Boost Mobile are trademarks of their owners. Stoop is independent and isn't affiliated with or endorsed by any of them. Example stores are fictional. Stoop reads your city and the places in your community through Qloo's aggregate taste data; it never sees a shopper.";

/**
 * The first table's result, under its photo in the real table section (PILOT_COPY only), as the founder
 * confirmed it on Oct 30: percentages only, no device counts. What was seen that day, never phrased as
 * Stoop causing it, and always beside PILOT_RESULT_LABEL. Null renders nothing.
 */
export const PILOT_RESULT: { line: string } | null = {
  line: "About 30% more walk-ins than a usual Friday, across the whole day, and about twice the usual device sales.",
};

/** Always said next to a pilot result. */
export const PILOT_RESULT_LABEL = "Oct 30, the day before Halloween. One day: a first look, not proof.";
