import { notFound } from "next/navigation";
import { exampleOgImage, OG_CONTENT_TYPE, OG_SIZE } from "@/components/stoop/marketing/og/card";
import { EXAMPLES } from "@/lib/demo/examples";
import { isExampleSlug } from "@/lib/report/load";

export const alt = "A Stoop example report: the Reality Check, concept worlds and Campaign Kit, with Qloo receipts.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return EXAMPLES.map(({ slug }) => ({ slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isExampleSlug(slug)) notFound();
  return exampleOgImage(slug);
}
