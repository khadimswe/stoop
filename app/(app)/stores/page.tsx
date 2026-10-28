import type { Metadata } from "next";
import { StoresView } from "@/components/stoop/stores/stores-view";
import { examplePlanPath } from "@/lib/plan/example-list";
import { loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { storeRow } from "@/lib/plan/view/stores";

// "My stores" for a demo dealer: the example stores, each with its next event. Prerendered from the
// recorded runs, zero API calls. Accounts and a dealer's real stores come after judging.
export const metadata: Metadata = {
  title: "My stores · Stoop",
  description: "Every store's next event, for store, multi-store and district managers.",
};

export default function StoresPage() {
  const stores = recordedPlanSlugs().map((slug) => storeRow(slug, loadPlanExampleView(slug), examplePlanPath(slug)));
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pt-8 pb-20 sm:px-5 sm:pt-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%] sm:text-[2rem]">My stores</h1>
        <p className="text-sm text-ink-soft">Demo dealer: {stores.length} fictional stores. Not affiliated with or endorsed by T-Mobile.</p>
      </div>
      <StoresView stores={stores} />
    </main>
  );
}
