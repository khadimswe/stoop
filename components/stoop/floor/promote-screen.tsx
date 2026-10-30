"use client";

import { ChevronLeft } from "lucide-react";
import { useSyncExternalStore } from "react";
import { MetaConnect } from "@/components/stoop/promote/meta-connect";
import { ShareMode } from "@/components/stoop/promote/share-mode";
import { useMinuteNow } from "@/components/stoop/promote/timeline";
import { useMarketing } from "@/components/stoop/promote/use-marketing";
import { planExampleSlug } from "@/lib/plan/example-list";
import type { PlanInputs } from "@/lib/plan/schema";
import { promoteTimeline, type PromoteScreenView } from "@/lib/plan/view/promote";
import { AppBar, IconSlot, ScreenTitle, Stepper, type Step } from "./kit";

const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

/**
 * Step 5, promote: "Nothing posts until you approve." The announcement now and a reminder at each of
 * the plan's times, each with its own words, grouped by day. Where posting from Stoop is off (and for
 * every example store) each post shares in one tap from here; with ENABLE_META_POSTING on and Meta
 * connected, the same timeline is approved and posted (components/stoop/promote/meta-connect.tsx).
 * Share mode shows at once: posting mode replaces it only once the server says posting is on.
 */
export function PromoteScreen({ view, inputs, hrefs }: { view: PromoteScreenView; inputs: PlanInputs; hrefs: { back: string; steps: Partial<Record<Step, string>> } }) {
  const origin = useOrigin();
  const now = useMinuteNow();
  const example = planExampleSlug(view.id) !== null;
  const m = useMarketing(view, !example);
  const days = promoteTimeline({ id: view.id, marketing: m.marketing, wheel: view.wheel }, inputs, now);
  const eventUrl = `${origin}${m.marketing.eventPath}`;
  const making = m.phase !== "ready" && m.marketing.posts === null;
  const header = <ScreenTitle title="Promote" meta="Nothing posts until you approve." />;
  const share = (
    <ShareMode
      planId={view.id}
      storeName={view.header.storeName}
      marketing={m.marketing}
      days={days}
      eventUrl={eventUrl}
      eventTitle={view.concept?.title ?? view.header.storeName}
      making={making}
      fictional={view.header.fictional}
      header={header}
    />
  );
  return (
    <>
      <AppBar
        left={
          <IconSlot href={hrefs.back} label="Back to the poster">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Promote"
      />
      <Stepper current="Promote" hrefs={hrefs.steps} />
      <main className="flex flex-1 flex-col">
        {example ? (
          share
        ) : (
          <MetaConnect planId={view.id} inputs={inputs} days={days} marketing={m.marketing} making={making} storeName={view.header.storeName} header={header} fallback={share} />
        )}
      </main>
    </>
  );
}
