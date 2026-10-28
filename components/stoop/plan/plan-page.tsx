import type { ReactNode } from "react";
import type { PlanView } from "@/lib/plan/view/plan";
import { StickyBar } from "../sticky-bar";
import { ConceptSection } from "./concept-section";
import { Disclosure } from "./disclosure";
import { GenericCompare } from "./generic-section";
import { YourBlock } from "./local-section";
import { Checklist, RunOfShow, ShoppingSection } from "./logistics";
import { MarketingSection } from "./marketing-section";
import { PlanHeader } from "./plan-header";
import { PlanNav } from "./plan-nav";
import { PlanReceipts } from "./receipts";
import { ResultsSection } from "./results-section";
import { TraceSection } from "./trace-section";
import { WheelSection } from "./wheel-section";

/**
 * One store's event plan, for example stores and live runs alike. The first screen is the event:
 * its name, when and where, and four tiles (music, snacks, wheel, posting). Then tabs to Event,
 * Wheel, Shopping, Posts and Results. The run of show, the checklist, the generic comparison, the
 * block and the agent's steps sit in closed rows, one tap deeper. Receipts are sent once
 * (`view.receipts`) and opened by "Why Qloo picked this".
 *
 * - `running`: a live run still streaming; empty parts say what is on the way.
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
  const more = (
    <>
      {view.runOfShow.length > 0 && (
        <Disclosure title="Run of show" meta={`${view.runOfShow.length} steps`}>
          <RunOfShow steps={view.runOfShow} />
        </Disclosure>
      )}
      {view.checklist.length > 0 && (
        <Disclosure title="Checklist" meta={`${view.checklist.length} items`}>
          <Checklist items={view.checklist} />
        </Disclosure>
      )}
      {view.generic && (
        <Disclosure title="Compare with a generic AI plan" meta={view.generic.cliches.length ? `${view.generic.cliches.length} clichés` : undefined}>
          <GenericCompare generic={view.generic} comparison={view.comparison} theme={view.concept?.title ?? null} />
        </Disclosure>
      )}
      {(view.local.block || view.local.city) && (
        <Disclosure title="Your block" meta={view.local.block ? `${view.local.block.places.length} places` : undefined}>
          <YourBlock view={view.local} partnerIds={view.partnerIds} />
        </Disclosure>
      )}
    </>
  );
  return (
    <PlanReceipts receipts={view.receipts}>
      <Root className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pt-5 pb-16 sm:px-5 sm:pt-8">
          {top}
          <PlanHeader view={view.header} kind={view.kind} concept={view.concept} tiles={view.tiles} />
          {view.partial && (
            <p className="rounded-xl border border-dashed border-concrete-line bg-surface px-4 py-3 text-sm">
              <span className="font-semibold">Partial plan:</span> {view.partial.reason}
            </p>
          )}
          <PlanNav wheel={view.wheel !== null} />
          <ConceptSection concept={view.concept} pending={running} more={more} />
          {view.wheel && <WheelSection wheel={view.wheel} />}
          <ShoppingSection items={view.shopping} budgetText={view.header.budgetText.replace(" budget", "")} totalText={view.shoppingTotal} pending={running} />
          <MarketingSection view={view.marketing} planId={view.id} storeName={view.header.storeName} allowGenerate={!running && view.concept !== null} />
          <ResultsSection planId={view.id} results={view.results} saveable={view.kind === "live"} />
          <div className="flex flex-col gap-3">
            <TraceSection rows={view.trace} calls={view.calls} live={running} />
            <footer className="flex flex-col gap-1 text-xs text-ink-soft">
              {view.header.fictional && <p>{view.header.fictional}</p>}
              <p>No carrier logos. No alcohol, tobacco or minors.</p>
              <p>No sales claims: a real store pilot measures that.</p>
            </footer>
          </div>
        </div>
        <StickyBar note={stickyNote} action={stickyAction} />
      </Root>
    </PlanReceipts>
  );
}
