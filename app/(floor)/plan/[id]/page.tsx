import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StandInBar } from "@/components/stoop/floor/stand-in";
import { EventScreen } from "@/components/stoop/floor/event-screen";
import { LiveStep } from "@/components/stoop/floor/live-plan";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 3, the event. Example stores ("ex-<slug>") are prerendered from their recorded runs; a live
// plan streams in from its events in the browser. The id is read behind <Suspense>.
export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

export async function generateMetadata({ params }: PageProps<"/plan/[id]">): Promise<Metadata> {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) {
    const view = loadPlanExampleView(slug);
    return { title: `${view.concept?.title ?? view.header.storeName} · Stoop example`, description: `A recorded Stoop plan for a fictional store in ${view.header.cityLine}.` };
  }
  return { title: "Your event · Stoop", robots: { index: false, follow: false } };
}

const LIVE_PLAN_ID = /^plan_[0-9a-f]{24}$/;

async function Step({ params }: { params: PageProps<"/plan/[id]">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) {
    const h = exampleHrefs(slug);
    const view = loadPlanExampleView(slug);
    return (
      <>
        <StandInBar slug={slug} storeName={view.header.storeName} withNote />
        <EventScreen view={view} hrefs={{ back: h.block, poster: h.poster, steps: h.steps }} exampleSlug={slug} />
      </>
    );
  }
  if (!LIVE_PLAN_ID.test(id)) notFound();
  return <LiveStep planId={id} step="event" />;
}

export default function EventPage({ params }: PageProps<"/plan/[id]">) {
  return (
    <Suspense fallback={<PlanLoading step="Event" />}>
      <Step params={params} />
    </Suspense>
  );
}
