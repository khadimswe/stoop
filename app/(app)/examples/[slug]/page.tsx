import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportPage } from "@/components/stoop/report/report-page";
import { JudgeBanner } from "@/components/stoop/report/sections/judge-banner";
import { EXAMPLES } from "@/lib/demo/examples";
import { isExampleSlug, loadExampleMedia, loadExampleReport } from "@/lib/report/load";
import { reportView } from "@/lib/report/view/report";

// The three example reports: recorded runs, prerendered at build time with zero API calls.
// `ensureStatic = "navigation"` makes the build fail if anything here ever reads request data.
// Unknown slugs 404 (Cache Components has no dynamicParams = false).
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return EXAMPLES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/examples/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const example = EXAMPLES.find((e) => e.slug === slug);
  if (!example) return {};
  const report = loadExampleReport(example.slug);
  return {
    title: `${example.brandName} example · Stoop`,
    description: `A recorded Stoop run for ${report.inputs.product.name}: the Reality Check, concept worlds and Campaign Kit, grounded in Qloo taste data.`,
  };
}

export default async function ExamplePage({ params }: PageProps<"/examples/[slug]">) {
  const { slug } = await params;
  if (!isExampleSlug(slug)) notFound();
  const view = reportView(loadExampleReport(slug), {
    media: loadExampleMedia(slug),
    // The static default. Each video line asks GET /api/render/access after mount and swaps it (BYOK
    // for anyone, "Render draft video" with a judge pass); the judge banner does the same for the top
    // world, so the page stays prerendered.
    renderAccess: { kind: "off" },
  });
  const top = view.outputs.find((o) => !o.isControl);
  return <ReportPage view={view} banner={<JudgeBanner target={top?.target ?? null} />} />;
}
