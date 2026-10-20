import { OG_CONTENT_TYPE, OG_SIZE, exampleScreen, ogImage } from "@/components/stoop/marketing/og/card";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";

// The default card for every page (the landing included), built at build time from the lead example.
export const alt = "Stoop: Stop making ads for nobody. A recorded Reality Check from Qloo's taste data.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({
    kicker: "Data, not stereotypes.",
    title: "Stop making ads for nobody.",
    sub: "Ads are free to make now. Knowing who they're for isn't.",
    screen: exampleScreen(LEAD_EXAMPLE.slug),
  });
}
