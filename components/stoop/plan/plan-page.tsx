import type { ReactNode } from "react";
import type { PlanView } from "@/lib/plan/view/plan";
import { StickyBar } from "../sticky-bar";
import { ConceptSection } from "./concept-section";
import { GenericSection } from "./generic-section";
import { LocalSection } from "./local-section";
import { ChecklistSection, RunOfShowSection, ShoppingSection } from "./logistics";
import { MarketingSection } from "./marketing-section";
import { PlanHeader } from "./plan-header";
import { PlanNav } from "./plan-nav";
import { PlanReceipts } from "./receipts";
import { ResultsSection } from "./results-section";
import { TraceSection } from "./trace-section";

/**
 * One store's event plan, one scrolling page, for example stores and live runs alike: the header, the
 * kept concept, the run of show, the shopping list and the checklist, the generic AI plan beside it,
 * the city and the block Qloo measured, the poster and posts, "Log results", then the agent's steps.
 * Every receipt on the page is sent once (`view.receipts`) and opened by key.
 *
 * - `running`: a live run still streaming; empty sections say what is on the way.
 * - `top`: a slot above the header (the live progress rail, the example notice).
 * - `stickyAction`: the page's one brick primary.
 */
export function PlanPage({
  view,
  running = false,
  top,
  stickyAction,
  stickyNote,
  landmark = true,
}: {
  view: PlanView;
  running?: boolean;
  top?: ReactNode;
  stickyAction?: ReactNode;
  stickyNote?: ReactNode;
  landmark?: boolean;
}) {
  const Root = landmark ? "main" : "div";
  return (
    <PlanReceipts receipts={view.receipts}>
      <Root className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 pt-6 pb-16 sm:px-5 sm:pt-8">
          {top}
          <PlanHeader view={view.header} kind={view.kind} concept={view.concept} aside={<RunOfShowSection steps={view.runOfShow} pending={running} />} />
          {view.partial && (
            <p className="rounded-xl border border-dashed border-concrete-line bg-surface px-4 py-3 text-sm">
              <span className="font-semibold">Partial plan:</span> {view.partial.stageLabel} stopped early. {view.partial.reason}
            </p>
          )}
          <PlanNav />
          <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <ConceptSection concept={view.concept} alternatives={view.alternatives} pending={running} />
            <ShoppingSection items={view.shopping} costLine={view.costLine} budgetText={view.header.budgetText.replace(" budget", "")} totalText={view.shoppingTotal} pending={running} />
          </div>
          <ChecklistSection items={view.checklist} pending={running} />
          <GenericSection generic={view.generic} comparison={view.comparison} city={view.local.city?.name ?? "this city"} theme={view.concept?.title ?? null} pending={running} />
          <LocalSection view={view.local} partnerIds={view.partnerIds} pending={running} />
          <MarketingSection view={view.marketing} planId={view.id} storeName={view.header.storeName} allowGenerate={!running && view.concept !== null} />
          <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
            <ResultsSection planId={view.id} results={view.results} saveable={view.kind === "live"} />
            <TraceSection rows={view.trace} calls={view.calls} live={running} />
          </div>
          <footer className="flex flex-col gap-1 border-t border-hairline pt-6 text-xs text-ink-soft">
            {view.header.fictional && <p className="font-semibold text-ink">{view.header.fictional}</p>}
            <p>No carrier logos: the store adds its own official brand assets. No alcohol or tobacco giveaways, and nothing aimed at minors.</p>
            <p>Stoop does not claim more traffic or sales. A pilot at a real store measures that after judging.</p>
          </footer>
        </div>
        <StickyBar note={stickyNote} action={stickyAction} />
      </Root>
    </PlanReceipts>
  );
}
