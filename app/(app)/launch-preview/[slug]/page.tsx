import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LaunchSection } from "@/components/stoop/report/sections/launch";
import { EXAMPLES } from "@/lib/demo/examples";
import { isExampleSlug, loadExampleReport } from "@/lib/report/load";
import { launchPlanView } from "@/lib/report/view/launch";

// A review page for the Launch plan, alone, on each example's recorded run, before it joins the
// report. Static (zero API calls) and kept out of search; it goes away once the report shows it.
export const ensureStatic = "navigation";

export const metadata: Metadata = {
  title: "Launch plan preview · Stoop",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return EXAMPLES.map(({ slug }) => ({ slug }));
}

export default async function LaunchPreviewPage({ params }: PageProps<"/launch-preview/[slug]">) {
  const { slug } = await params;
  if (!isExampleSlug(slug)) notFound();
  const example = EXAMPLES.find((e) => e.slug === slug)!;
  const view = launchPlanView(loadExampleReport(slug));
  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 pb-16 sm:px-5 sm:pt-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-[1.625rem] leading-tight font-extrabold [font-stretch:85%]">{example.brandName}</h1>
          <p className="text-sm text-ink-soft">
            Preview of the Launch plan on this example&apos;s recorded run.{" "}
            <Link href={`/examples/${slug}`} className="font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
              Open the full report
            </Link>
          </p>
        </div>
        <LaunchSection view={view} reportPath={`/examples/${slug}`} />
      </div>
    </main>
  );
}
