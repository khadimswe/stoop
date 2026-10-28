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
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 pt-6 pb-16 sm:px-5 sm:pt-8">
          {top}
          <PlanHeader view={view.header} kind={view.kind} />
          {view.partial && (
            <p className="rounded-xl border border-dashed border-concrete-line bg-surface px-4 py-3 text-sm">
              <span className="font-semibold">Partial plan:</span> {view.partial.stageLabel} stopped early. {view.partial.reason}
            </p>
          )}
          <PlanNav />
          <ConceptSection concept={view.concept} alternatives={view.alternatives} pending={running} />
          <RunOfShowSection steps={view.runOfShow} pending={running} />
          <ShoppingSection items={view.shopping} costLine={view.costLine} pending={running} />
          <ChecklistSection items={view.checklist} pending={running} />
          <GenericSection concept={view.concept} generic={view.generic} comparison={view.comparison} pending={running} />
          <LocalSection view={view.local} pending={running} />
          <MarketingSection view={view.marketing} planId={view.id} storeName={view.header.storeName} allowGenerate={!running && view.concept !== null} />
          <ResultsSection planId={view.id} results={view.results} saveable={view.kind === "live"} />
          <TraceSection rows={view.trace} calls={view.calls} live={running} />
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
