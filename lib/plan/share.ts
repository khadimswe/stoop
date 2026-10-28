// One-tap share links for a plan's posts. Nothing posts on its own: each link opens the network's own
// share screen with the draft filled in, and the manager taps Post there. Facebook's sharer takes the
// public event page (/e/<id>), whose link preview is the poster; WhatsApp takes the message plus that
// URL. Instagram has no web share, so it gets the caption to copy and the poster to download.
// A plain module (no server imports): the pages build the links from their own origin.
import type { Posts } from "./schema";

const clean = (origin: string) => origin.trim().replace(/\/+$/, "");

/** An A/B test's variant: "a" is the plan's kept concept, "b" the test's second concept. */
export type Variant = "a" | "b";

/** The public event page at /e/<id> (?variant=b shows variant B's poster in the link preview). */
export function eventUrl(origin: string, id: string, variant: Variant = "a"): string {
  return `${clean(origin)}/e/${encodeURIComponent(id)}${variant === "b" ? "?variant=b" : ""}`;
}

/** The composited poster: 1080 by 1350 for Instagram portrait, or 1200 by 630 ("og") for link previews. */
export function posterUrl(origin: string, id: string, size: "portrait" | "og" = "portrait", variant: Variant = "a"): string {
  const query = [...(size === "og" ? ["size=og"] : []), ...(variant === "b" ? ["variant=b"] : [])].join("&");
  return `${clean(origin)}/api/plan/${encodeURIComponent(id)}/marketing/poster.png${query ? `?${query}` : ""}`;
}

export function facebookShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

/** The WhatsApp message as sent: the draft, a blank line, then the event page. */
export function whatsappMessage(text: string, url: string): string {
  return `${text.trim()}\n\n${url}`;
}

export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsappMessage(text, url))}`;
}

/** The share links for a plan's posts (or variant B's), from the page's origin. */
export function shareLinks(origin: string, id: string, posts: Pick<Posts, "whatsapp">, variant: Variant = "a"): Posts["share"] {
  const url = eventUrl(origin, id, variant);
  return { facebook: facebookShareUrl(url), whatsapp: whatsappShareUrl(posts.whatsapp.text, url) };
}

/** Instagram: the caption with its hashtags, ready to paste, since there is no web share. */
export function instagramCopy(posts: Pick<Posts, "instagram">): string {
  const tags = posts.instagram.hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
  return tags ? `${posts.instagram.caption.trim()}\n\n${tags}` : posts.instagram.caption.trim();
}
