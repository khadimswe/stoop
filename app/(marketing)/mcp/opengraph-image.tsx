import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/components/stoop/marketing/og/card";

export const alt = "Use Stoop inside your Claude: score_brief and culture_brief, with your own video tools.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({
    kicker: "Stoop in Claude",
    title: "Use Stoop inside your Claude",
    sub: "Works inside your Claude, with your own video tools.",
    screen: {
      label: "Two tools",
      lines: [
        { text: "score_brief: checks a brief's creative choices against Qloo's taste data." },
        { text: "culture_brief: starts a full run and sends back the report link." },
      ],
    },
  });
}
