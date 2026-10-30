// The landing's "Before and after" slot, as the page shows it: two real photos from the pilot, each
// with its visible label and caption, and an optional AI preview that always says it is one. Pure, so
// the rule is tested without a browser.
import type { BeforeAfter } from "./pilot";

/** Printed on the AI preview, in the picture and in its text alternative. Never left out. */
export const AI_PREVIEW_LABEL = "AI preview";

export interface BeforeAfterItem {
  key: "before" | "after" | "preview";
  src: string;
  alt: string;
  /** The visible tag on the picture: "Before", "After" or "AI preview". */
  label: string;
  caption: string;
}

/** The pictures in order; none when the slot is not set. */
export function beforeAfterItems(config: BeforeAfter | null): BeforeAfterItem[] {
  if (!config) return [];
  const items: BeforeAfterItem[] = [
    { key: "before", src: config.before.src, alt: config.before.alt, label: "Before", caption: config.before.caption },
    { key: "after", src: config.after.src, alt: config.after.alt, label: "After", caption: config.after.caption },
  ];
  if (config.preview) {
    const alt = config.preview.alt.trim();
    items.push({
      key: "preview",
      src: config.preview.src,
      alt: alt.toLowerCase().startsWith(AI_PREVIEW_LABEL.toLowerCase()) ? alt : `${AI_PREVIEW_LABEL}: ${alt}`,
      label: AI_PREVIEW_LABEL,
      caption: "An AI preview of the planned table, not a photo.",
    });
  }
  return items;
}
