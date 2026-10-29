import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { StoresScreen, type StoreCard } from "@/components/stoop/floor/stores-screen";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { PLAN_EXAMPLE_INPUTS, type PlanExampleSlug } from "@/lib/plan/example-list";
import { eventDate } from "@/lib/plan/view/format";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { usd } from "@/lib/plan/view/format";

// My stores for a demo dealer: the example stores, each with its next event, from their recorded
// runs. Accounts and a dealer's own stores come after judging.
export const metadata: Metadata = {
  title: "My stores · Stoop",
  description: "Every store's next event on one list, for multi-store and district managers.",
};

function cards(): StoreCard[] {
  return recordedPlanSlugs().map((slug) => {
    const view = loadPlanExampleView(slug);
    const inputs = PLAN_EXAMPLE_INPUTS[slug as PlanExampleSlug];
    const spent = view.shopping.reduce((sum, s) => sum + (s.usd ?? 0), 0);
    const posted = view.results.some((r) => r.postedOn.length > 0);
    const status: StoreCard["status"] = !view.concept ? null : posted ? { tone: "ok", label: "Posted" } : view.marketing.posts ? { tone: "ready", label: "Poster ready" } : { tone: "draft", label: "Planned" };
    return {
      slug,
      storeName: view.header.storeName,
      storeNumber: view.header.storeNumber,
      cityLine: view.header.cityLine,
      eventTitle: view.concept?.title ?? null,
      when: view.concept ? `${view.header.dateShort} · ${view.header.timeText}` : null,
      date: inputs.date,
      poster: view.marketing.poster.thumb ? { src: view.marketing.poster.thumb, alt: view.marketing.poster.alt } : null,
      status,
      fact: view.concept ? `${usd(spent)} of ${view.header.budgetText.replace(" budget", "")}` : null,
      href: exampleHrefs(slug).event,
      blockHref: exampleHrefs(slug).block,
    };
  });
}

// "Upcoming" is read against today, so the list renders per request (the data is static).
async function Stores() {
  await connection();
  const list = cards();
  const today = new Date().toISOString().slice(0, 10);
  const next = list
    .map((s) => s.date)
    .filter((d): d is string => d !== null && d >= today)
    .sort()[0];
  return <StoresScreen stores={list} today={today} nextEvent={next ? eventDate(next, "short") : null} note="Fictional stores. Not affiliated with or endorsed by T-Mobile." />;
}

export default function StoresPage() {
  return (
    <Suspense fallback={<PlanLoading step="Community" />}>
      <Stores />
    </Suspense>
  );
}
