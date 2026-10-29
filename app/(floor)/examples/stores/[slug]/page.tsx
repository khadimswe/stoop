import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { examplePlanId } from "@/lib/plan/example-list";
import { isRecordedPlanSlug, recordedPlanSlugs } from "@/lib/plan/view/load";

// The old example address: each example store's event now lives at /plan/ex-<slug>.
export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ slug }));
}

async function Go({ params }: { params: PageProps<"/examples/stores/[slug]">["params"] }): Promise<null> {
  const { slug } = await params;
  if (!isRecordedPlanSlug(slug)) notFound();
  permanentRedirect(`/plan/${examplePlanId(slug)}`);
  return null;
}

export default function OldExamplePage({ params }: PageProps<"/examples/stores/[slug]">) {
  return (
    <Suspense fallback={<PlanLoading step="Event" />}>
      <Go params={params} />
    </Suspense>
  );
}
