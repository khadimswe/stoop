import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LivePlan } from "@/components/stoop/plan/live-plan";
import { PlanSkeleton } from "@/components/stoop/plan/plan-states";
import { examplePlanPath, planExampleSlug } from "@/lib/plan/example-list";

// A live plan. The shell (the app bar and the skeleton) is static; the plan streams in from its
// events in the browser (components/stoop/plan/live-plan.tsx). An example's id ("ex-<slug>") goes to
// the example's own prerendered page. The id is request data, so it is read behind <Suspense>.
export const metadata: Metadata = {
  title: "Your event plan · Stoop",
  robots: { index: false, follow: false },
};

/** "plan_" plus 24 hex: a live plan id (lib/plan/store.ts). */
const LIVE_PLAN_ID = /^plan_[0-9a-f]{24}$/;

async function PlanLoader({ params }: { params: PageProps<"/plan/[id]">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug) redirect(examplePlanPath(slug));
  if (!LIVE_PLAN_ID.test(id)) notFound();
  return <LivePlan planId={id} />;
}

export default function PlanRoute({ params }: PageProps<"/plan/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<PlanSkeleton />}>
        <PlanLoader params={params} />
      </Suspense>
    </main>
  );
}
