import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StandInBar } from "@/components/stoop/floor/stand-in";
import { CreateScreen } from "@/components/stoop/floor/create-screen";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { PLAN_EXAMPLE_INPUTS, type PlanExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 2 for an example store: the form, filled with what the example was recorded with (the day too).
export const metadata: Metadata = { title: "New event · Stoop" };

export function generateStaticParams() {
  return recordedPlanSlugs().map((store) => ({ store }));
}

async function Create({ params }: { params: PageProps<"/s/[store]/new">["params"] }) {
  const { store } = await params;
  if (!isRecordedPlanSlug(store)) notFound();
  const inputs = PLAN_EXAMPLE_INPUTS[store as PlanExampleSlug];
  const h = exampleHrefs(store);
  const s = inputs.store;
  return (
    <>
      <StandInBar slug={store} storeName={s.name} />
      <CreateScreen
        store={{ name: s.name, address: s.address, city: s.city, region: s.region, lat: s.point.lat, lon: s.point.lon, carrier: s.carrier, phone: s.phone, storeNumber: s.storeNumber }}
        defaults={{
          offers: inputs.offers.map((o) => o.text),
          ageBands: inputs.ageBands,
          setting: inputs.setting,
          game: inputs.game ?? "wheel",
          notes: inputs.notes ?? "",
          startTime: inputs.startTime,
          durationMinutes: String(inputs.durationMinutes),
          budgetUsd: String(inputs.budgetUsd),
          // The recorded day: what is sent matches the plan that opens (the form keeps it while it is ahead).
          date: inputs.date,
          ...(inputs.location ? { venueName: inputs.location.name, venueLat: String(inputs.location.point.lat), venueLon: String(inputs.location.point.lon) } : {}),
        }}
        backHref={h.block}
        steps={h.steps}
      />
    </>
  );
}

export default function NewEventPage({ params }: PageProps<"/s/[store]/new">) {
  return (
    <Suspense fallback={<PlanLoading step="Create" />}>
      <Create params={params} />
    </Suspense>
  );
}
