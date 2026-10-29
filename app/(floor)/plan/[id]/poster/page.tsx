import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveStep } from "@/components/stoop/floor/live-plan";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { PosterScreen } from "@/components/stoop/floor/poster-screen";
import { posterScreenView } from "@/lib/plan/view/promote";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 4, the poster. Examples are prerendered; a live plan loads in the browser.
export const metadata: Metadata = { title: "Poster · Stoop" };

export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

async function Step({ params }: { params: PageProps<"/plan/[id]/poster">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) {
    const h = exampleHrefs(slug);
    return <PosterScreen view={posterScreenView(loadPlanExampleView(slug))} live={false} hrefs={{ back: h.event, promote: h.promote, steps: h.steps }} />;
  }
  if (!/^plan_[0-9a-f]{24}$/.test(id)) notFound();
  return <LiveStep planId={id} step="poster" />;
}

export default function PosterPage({ params }: PageProps<"/plan/[id]/poster">) {
  return (
    <Suspense fallback={<PlanLoading step="Poster" />}>
      <Step params={params} />
    </Suspense>
  );
}
