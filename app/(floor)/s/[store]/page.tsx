import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BlockScreen } from "@/components/stoop/floor/block-screen";
import { PlanLoading } from "@/components/stoop/floor/plan-loading";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { isRecordedPlanSlug, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";

// Step 1, a store's home: its block. The example stores are prerendered from their recorded runs; a
// new store's block is measured on /start.
export function generateStaticParams() {
  return recordedPlanSlugs().map((store) => ({ store }));
}

export async function generateMetadata({ params }: PageProps<"/s/[store]">): Promise<Metadata> {
  const { store } = await params;
  if (!isRecordedPlanSlug(store)) return {};
  const view = loadPlanExampleView(store);
  return { title: `${view.header.storeName}: your block · Stoop`, description: `The block around a fictional store in ${view.header.cityLine}, from Qloo.` };
}

async function Block({ params }: { params: PageProps<"/s/[store]">["params"] }) {
  const { store } = await params;
  if (!isRecordedPlanSlug(store)) notFound();
  const view = loadPlanExampleView(store);
  return (
    <BlockScreen
      storeName={view.header.storeName}
      cityLine={view.header.cityLine}
      address={view.header.address}
      local={view.local}
      uses={view.placeUses}
      receipts={view.receipts}
      createHref={exampleHrefs(store).create}
      fictional={view.header.fictional}
    />
  );
}

export default function StorePage({ params }: PageProps<"/s/[store]">) {
  return (
    <Suspense fallback={<PlanLoading step="Block" />}>
      <Block params={params} />
    </Suspense>
  );
}
