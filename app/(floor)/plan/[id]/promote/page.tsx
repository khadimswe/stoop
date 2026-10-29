import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LiveStep } from "@/components/stoop/floor/live-plan";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { PromoteScreen } from "@/components/stoop/floor/promote-screen";
import { promoteScreenView } from "@/lib/plan/view/promote";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, loadPlanExampleReport, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 5, promote. Examples are prerendered; a live plan loads in the browser.
export const metadata: Metadata = { title: "Promote · Stoop" };

export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

async function Step({ params }: { params: PageProps<"/plan/[id]/promote">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) {
    const h = exampleHrefs(slug);
    const { inputs } = loadPlanExampleReport(slug);
    return <PromoteScreen view={promoteScreenView(loadPlanExampleView(slug))} inputs={inputs} hrefs={{ back: h.poster, steps: h.steps }} />;
  }
  if (!/^plan_[0-9a-f]{24}$/.test(id)) notFound();
  return <LiveStep planId={id} step="promote" />;
}

export default function PromotePage({ params }: PageProps<"/plan/[id]/promote">) {
  return (
    <Suspense fallback={<PlanLoading step="Promote" />}>
      <Step params={params} />
    </Suspense>
  );
}
