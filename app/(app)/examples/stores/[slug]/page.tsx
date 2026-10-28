import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExampleNotice } from "@/components/stoop/plan/example-notice";
import { PlanPage } from "@/components/stoop/plan/plan-page";
import { PlanSkeleton } from "@/components/stoop/plan/plan-states";
import { Button } from "@/components/ui/button";
import { examplePlanId } from "@/lib/plan/example-list";
import { isRecordedPlanSlug, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { posterRoute } from "@/lib/plan/view/plan";

// The example stores: recorded runs, prerendered at build time with zero API calls. Only examples
// whose recording is on disk are built; any other slug 404s. The slug is read behind <Suspense>, so a
// client navigation shows the page's shape at once while the prerendered plan streams in.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/examples/stores/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isRecordedPlanSlug(slug)) return {};
  const view = loadPlanExampleView(slug);
  const title = view.concept ? `${view.concept.title} · ${view.header.storeName}` : view.header.storeName;
  return {
    title: `${title} · Stoop example`,
    description: `A recorded Stoop plan for a fictional ${view.header.carrierLabel} store in ${view.header.cityLine}: the event, the run of show, the shopping list and the generic AI plan beside it.`,
    openGraph: view.marketing.poster.status === "ready" ? { images: [{ url: posterRoute(examplePlanId(slug), "og"), width: 1200, height: 630 }] } : undefined,
  };
}

async function ExamplePlan({ params }: { params: PageProps<"/examples/stores/[slug]">["params"] }) {
  const { slug } = await params;
  if (!isRecordedPlanSlug(slug)) notFound();
  return (
    <PlanPage
      view={loadPlanExampleView(slug)}
      landmark={false}
      top={<ExampleNotice />}
      stickyNote="Want one for your store?"
      stickyAction={
        <Button asChild className="w-full shrink-0 sm:w-auto">
          <Link href="/start">Plan this Saturday for my store</Link>
        </Button>
      }
    />
  );
}

export default function ExampleStorePage({ params }: PageProps<"/examples/stores/[slug]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<PlanSkeleton />}>
        <ExamplePlan params={params} />
      </Suspense>
    </main>
  );
}
