import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { LiveStep } from "@/components/stoop/floor/live-plan";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 1 for a live plan: the community the plan used, with its pins. An example's community lives
// at /s/<slug>.
export const metadata: Metadata = { title: "Your community · Stoop", robots: { index: false, follow: false } };

export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

const LIVE_PLAN_ID = /^plan_[0-9a-f]{24}$/;

async function Step({ params }: { params: PageProps<"/plan/[id]/community">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) permanentRedirect(exampleHrefs(slug).block);
  if (!LIVE_PLAN_ID.test(id)) notFound();
  return <LiveStep planId={id} step="community" />;
}

export default function LiveCommunityPage({ params }: PageProps<"/plan/[id]/community">) {
  return (
    <Suspense fallback={<PlanLoading step="Community" />}>
      <Step params={params} />
    </Suspense>
  );
}
