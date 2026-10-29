import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CreateScreen } from "@/components/stoop/floor/create-screen";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { PLAN_EXAMPLE_INPUTS, type PlanExampleSlug } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 2 for an example store: the form, filled with what the example was recorded with.
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
    <CreateScreen
      store={{ name: s.name, address: s.address, city: s.city, region: s.region, lat: s.point.lat, lon: s.point.lon, carrier: s.carrier, phone: s.phone, storeNumber: s.storeNumber }}
      defaults={{
        offers: inputs.offers.map((o) => o.text),
        ageBands: inputs.ageBands,
        setting: inputs.setting,
        notes: inputs.notes ?? "",
        startTime: inputs.startTime,
        durationMinutes: String(inputs.durationMinutes),
      }}
      backHref={h.block}
      steps={{ Community: h.block }}
    />
  );
}

export default function NewEventPage({ params }: PageProps<"/s/[store]/new">) {
  return (
    <Suspense fallback={<PlanLoading step="Create" />}>
      <Create params={params} />
    </Suspense>
  );
}
