import type { Metadata } from "next";
import { Suspense } from "react";
import { EventPage } from "@/components/stoop/event/event-page";
import { LiveEvent } from "@/components/stoop/event/live-event";
import { examplePlanId, planExampleSlug } from "@/lib/plan/example-list";
import { isRecordedPlanSlug, loadPlanExampleEventView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { posterRoute } from "@/lib/plan/view/plan";

// The public event page people open from a post. Example stores are prerendered; a live plan's page
// loads in the browser from GET /api/plan/[id]. The link preview image is the poster route's
// 1200 by 630 version either way.
export function generateStaticParams() {
  return recordedPlanSlugs().map((slug) => ({ id: examplePlanId(slug) }));
}

export async function generateMetadata({ params }: PageProps<"/e/[id]">): Promise<Metadata> {
  const { id } = await params;
  const slug = planExampleSlug(id);
  const images = [{ url: posterRoute(id, "og"), width: 1200, height: 630 }];
  if (slug && isRecordedPlanSlug(slug)) {
    const view = loadPlanExampleEventView(slug);
    const description = `${view.dateText}, ${view.timeText} at ${view.where}.`;
    return { title: `${view.title} · ${view.storeName}`, description, openGraph: { title: view.title, description, images }, twitter: { card: "summary_large_image", images } };
  }
  return { title: "An event near you", robots: { index: false, follow: false }, openGraph: { title: "An event near you", images }, twitter: { card: "summary_large_image", images } };
}

async function Event({ params }: { params: PageProps<"/e/[id]">["params"] }) {
  const { id } = await params;
  const slug = planExampleSlug(id);
  if (slug && isRecordedPlanSlug(slug)) return <EventPage view={loadPlanExampleEventView(slug)} />;
  return <LiveEvent planId={id} />;
}

export default function EventRoute({ params }: PageProps<"/e/[id]">) {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Event params={params} />
    </Suspense>
  );
}
