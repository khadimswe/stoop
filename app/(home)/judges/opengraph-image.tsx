import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/components/stoop/marketing/og/card";

export const alt = "Stoop for judges: a 90-second path through the Reality Check, the Screening Room and one receipt.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({
    kicker: "For judges",
    title: "A 90-second path through Stoop",
    sub: "Every audience fact and creative cue comes with a Qloo receipt.",
    screen: {
      label: "The path",
      lines: [{ text: "1. The Reality Check" }, { text: "2. The Screening Room" }, { text: "3. One receipt" }, { text: "4. Try it free" }],
    },
  });
}
