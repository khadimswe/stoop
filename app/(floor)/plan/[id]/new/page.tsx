import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { LiveStep } from "@/components/stoop/floor/live-plan";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 2 for a live plan: the form again, filled with what the plan was made from, to plan another.
// An example's form lives at /s/<slug>/new.
export const metadata: Metadata = { title: "New event · Stoop", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

const LIVE_PLAN_ID = /^plan_[0-9a-f]{24}$/;

async function Step({ params }: { params: PageProps<"/plan/[id]/new">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) permanentRedirect(exampleHrefs(slug).create);
  if (!LIVE_PLAN_ID.test(id)) notFound();
  return <LiveStep planId={id} step="create" />;
}

export default function LiveCreatePage({ params }: PageProps<"/plan/[id]/new">) {
  return (
    <Suspense fallback={<PlanLoading step="Create" />}>
      <Step params={params} />
    </Suspense>
  );
}
