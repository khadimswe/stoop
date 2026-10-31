"use client";

import { Check, ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import { askFacts } from "@/lib/plan/ask";
import { eventSpots } from "@/lib/plan/event-spots";
import { planningSteps, type PlanningStep } from "@/lib/plan/view/live";
import { planView, sourceFromReport, sourceFromState, traceRows, type PlanView } from "@/lib/plan/view/plan";
import type { PlanInputs } from "@/lib/plan/schema";
import { initialPlanState, type PlanState } from "@/lib/plan/events";
import { cn } from "cn";
import { usePlanEvents } from "../plan/use-plan-events";
import { BlockScreen } from "./block-screen";
import { CreateScreen } from "./create-screen";
import { EventScreen } from "./event-screen";
import { ActionBar, FloorHeader, IconSlot, Notice, PRIMARY, ScreenBody, ScreenTitle, type Step } from "./kit";
import { CreateAt } from "./plan-here";
import { PosterScreen } from "./poster-screen";
import { PromoteScreen } from "./promote-screen";

export type LiveStepName = "community" | "create" | "event" | "poster" | "promote";

const STEP_OF: Record<LiveStepName, Step> = { community: "Community", create: "Create", event: "Event", poster: "Poster", promote: "Promote" };

/** Where a live plan's steps link: its own community, its form (filled with what it was planned from), the event, poster and promote. */
export function liveHrefs(id: string) {
  const base = `/plan/${encodeURIComponent(id)}`;
  return {
    community: `${base}/community`,
    create: `${base}/new`,
    event: base,
    poster: `${base}/poster`,
    promote: `${base}/promote`,
    steps: { Community: `${base}/community`, Create: `${base}/new`, Event: base, Poster: `${base}/poster`, Promote: `${base}/promote` } as Partial<Record<Step, string>>,
  };
}

/** Steps a plan still being made can't open yet, and why. */
const NOT_YET: Partial<Record<Step, string>> = { Poster: "ready when the plan is done", Promote: "ready when the plan is done" };

/** A state that is not a plan: what happened and what to do, with one way on. */
function StateScreen({ step, title, children, action }: { step: Step; title: string; children: React.ReactNode; action: { href: string; label: string } }) {
  return (
    <>
      <FloorHeader
        left={
          <IconSlot href="/start" label="Back">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title={title}
        step={step}
      />
      <ScreenBody>
        <ScreenTitle title={title} />
        {children}
        <div className="hidden lg:block lg:max-w-xs">
          <Link href={action.href} className={PRIMARY}>
            {action.label}
          </Link>
        </div>
      </ScreenBody>
      <ActionBar className="lg:hidden">
        <Link href={action.href} className={PRIMARY}>
          {action.label}
        </Link>
      </ActionBar>
    </>
  );
}

const subscribeClock = (onTick: () => void) => {
  const t = window.setInterval(onTick, 1000);
  return () => window.clearInterval(t);
};
/** The time, to the second; it ticks while the planning screen is open. */
function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => 0,
  );
}
const clockText = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function StepMark({ step, n }: { step: PlanningStep; n: number }) {
  if (step.status === "done")
    return (
      <span className="flex size-6 items-center justify-center rounded-full bg-fl-ink">
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </span>
    );
  return (
    <span
      className={cn(
        "flex size-6 items-center justify-center rounded-full border-[1.5px] text-[0.6875rem] font-semibold tabular-nums",
        step.status === "current" ? "border-dashed border-fl-ink text-fl-ink motion-safe:animate-[spin_6s_linear_infinite]" : step.status === "stopped" ? "border-fl-bad text-fl-bad" : "border-fl-line text-fl-dim",
      )}
    >
      <span className={step.status === "current" ? "motion-safe:animate-[spin_6s_linear_infinite_reverse]" : undefined}>{n}</span>
    </span>
  );
}

/**
 * "Planning your event": the agent's work as six steps, filled live from the run's events, each with
 * where it came from (Qloo or Claude), what it found and how long it took, then every raw step under
 * "See every step". The run executes on the server after the request that started it and writes its
 * events to the store, so leaving the page does not stop it; this link shows it again.
 */
function PlanningScreen({ state, planId }: { state: PlanState | null; planId: string }) {
  const now = useNow();
  const steps = planningSteps(state ?? { ...initialPlanState, status: "running", current: "store" });
  const inputs = state?.report.inputs ?? null;
  const started = state?.createdAt ? Date.parse(state.createdAt) : null;
  const elapsed = started && now ? now - started : null;
  const trace = state ? traceRows(state.report.trace) : [];
  const hrefs = liveHrefs(planId);
  const meta = inputs ? `${inputs.store.name} · ${dayLine(inputs)} · $${inputs.budgetUsd}.` : null;
  return (
    <>
      <FloorHeader
        left={
          inputs ? (
            <IconSlot href={hrefs.community} label="Back to your community">
              <ChevronLeft aria-hidden="true" />
            </IconSlot>
          ) : undefined
        }
        title="Planning your event"
        subtitle={inputs ? `${inputs.store.city}, ${inputs.store.region}` : undefined}
        store={inputs ? { name: inputs.store.name, city: `${inputs.store.city}, ${inputs.store.region}` } : null}
        step="Event"
        hrefs={inputs ? { Community: hrefs.community, Create: hrefs.create } : {}}
        reasons={NOT_YET}
      />
      <ScreenBody className="lg:max-w-2xl">
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">While it plans, usually 1 to 2 minutes</p>
          <ScreenTitle title="Planning your event" />
          <p className="text-sm text-pretty text-fl-dim">
            {meta} You can leave this page; the plan keeps going and this link shows it.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <ol aria-label="Progress" aria-live="polite" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            {steps.map((s, i) => (
              <li key={s.key} className={cn("flex items-start gap-3 px-4 py-3.5", s.status === "current" && "bg-fl-sunk shadow-[inset_3px_0_0_var(--color-fl-ink)]")}>
                <span aria-hidden="true" className="mt-px shrink-0">
                  <StepMark step={s} n={i + 1} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-[0.9375rem] leading-5", s.status === "pending" ? "font-medium text-fl-dim" : "font-semibold")}>
                    <span className="sr-only">{s.status === "done" ? "Done: " : s.status === "current" ? "Working: " : s.status === "stopped" ? "Stopped: " : "Next: "}</span>
                    {s.title}
                  </span>
                  <span className="text-[0.8125rem] leading-[18px] text-fl-dim">
                    {[s.status !== "pending" || s.key === "marketing" ? s.source : null, s.detail, s.timeText].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {s.status === "current" && <span className="shrink-0 text-xs text-fl-dim">working</span>}
              </li>
            ))}
          </ol>
          <p className="flex items-center justify-between gap-3 px-1 text-[0.8125rem] text-fl-dim tabular-nums">
            <span>{elapsed !== null ? `Working for ${clockText(elapsed)}` : "Starting"}</span>
            <span>{trace.filter((t) => t.kind === "tool").length} Qloo calls so far</span>
          </p>
        </div>
        {trace.length > 0 && (
          <details className="group/f overflow-hidden rounded-[20px] bg-white">
            <summary className="flex min-h-[54px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex-1 text-[0.9375rem] font-medium">See every step</span>
              <span className="text-[0.8125rem] text-fl-dim tabular-nums">{trace.length}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fl-chev transition-transform group-open/f:rotate-180 motion-reduce:transition-none" />
            </summary>
            <ol aria-label="Agent steps" className="flex flex-col border-t border-fl-rule px-4 py-2">
              {trace.map((t) => (
                <li key={t.key} className="flex flex-col gap-0.5 border-b border-fl-rule py-2 text-sm last:border-b-0">
                  {t.startsGroup && <span className="text-[0.6875rem] font-semibold tracking-[0.04em] text-fl-dim uppercase">{t.stageLabel}</span>}
                  <span className={t.kind === "decision" ? "font-medium" : "text-fl-muted"}>
                    <span className="sr-only">{t.kind === "decision" ? "Agent decision: " : "Qloo call: "}</span>
                    {t.label}
                  </span>
                  {t.reason && <span className="text-[0.8125rem] text-fl-dim">{t.reason}</span>}
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="text-[0.8125rem] text-fl-dim">Nothing posts until you approve it on the Promote step.</p>
      </ScreenBody>
    </>
  );
}

function dayLine(inputs: PlanInputs): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${inputs.date}T12:00:00Z`));
  const [h, m] = inputs.startTime.split(":").map(Number) as [number, number];
  const at = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  return `${day}, from ${at}`;
}

/**
 * A live plan's steps, filled from its events (GET /api/plan/[id]/events). While the agent works the
 * Event step is "Planning your event" (six steps, live). Its Community step shows the community the
 * plan used; its Create step is the form, filled with what the plan was made from. Not found, failed
 * and offline each say what happened and what to do.
 */
export function LiveStep({ planId, step }: { planId: string; step: LiveStepName }) {
  const feed = usePlanEvents(planId);
  const hrefs = liveHrefs(planId);
  const built = useMemo((): { view: PlanView; inputs: PlanInputs } | null => {
    if (feed.phase === "report") return { view: planView(sourceFromReport(feed.report, planId)), inputs: feed.report.inputs };
    if (feed.phase === "streaming" || feed.phase === "ended") {
      const source = sourceFromState(feed.state, planId);
      return source ? { view: planView(source), inputs: source.inputs } : null;
    }
    return null;
  }, [feed, planId]);

  if (feed.phase === "not-found")
    return (
      <StateScreen step={STEP_OF[step]} title="This plan isn't here" action={{ href: "/start", label: "Plan an event" }}>
        <Notice title="Live plans are kept for a few days">This one has expired, or the link is wrong. Start a new plan; it takes a minute or two.</Notice>
      </StateScreen>
    );
  if (feed.phase === "error")
    return (
      <StateScreen step={STEP_OF[step]} title="Your event" action={{ href: hrefs.event, label: "Try again" }}>
        <Notice tone="bad" title="The plan didn't load">
          {feed.message}
        </Notice>
      </StateScreen>
    );
  if ((feed.phase === "streaming" || feed.phase === "ended") && feed.state.status === "failed" && !feed.state.report.plan)
    return (
      <StateScreen step="Event" title="The plan stopped" action={{ href: built ? hrefs.create : "/start", label: "Plan it again" }}>
        <Notice tone="bad" title="Stoop couldn't finish this plan">
          {feed.state.failure ?? "Something went wrong while planning."} Nothing was posted anywhere.
        </Notice>
      </StateScreen>
    );

  const state = feed.phase === "streaming" || feed.phase === "ended" ? feed.state : null;
  const running = feed.phase === "connecting" || (feed.phase === "streaming" && feed.state.status === "running");
  const planning = running || !built?.view.concept;
  const reasons = planning ? NOT_YET : undefined;
  const store = built ? { name: built.inputs.store.name, city: `${built.inputs.store.city}, ${built.inputs.store.region}` } : null;

  if (step === "community" && built)
    return (
      <BlockScreen
        storeName={store!.name}
        cityLine={store!.city}
        address={built.view.header.address}
        local={built.view.local}
        uses={built.view.placeUses}
        receipts={built.view.receipts}
        createHref={hrefs.create}
        eventHref={hrefs.event}
        steps={hrefs.steps}
        reasons={reasons}
        fictional={null}
        agesUrl={`/api/plan/${encodeURIComponent(planId)}/ages`}
      />
    );
  if (step === "create" && built) {
    const i = built.inputs;
    const props: ComponentProps<typeof CreateScreen> = {
      store: { name: i.store.name, address: i.store.address, city: i.store.city, region: i.store.region, lat: i.store.point.lat, lon: i.store.point.lon, carrier: i.store.carrier, phone: i.store.phone, storeNumber: i.store.storeNumber },
      defaults: {
        offers: i.offers.map((o) => o.text),
        ageBands: i.ageBands,
        setting: i.setting,
        game: i.game ?? "wheel",
        notes: i.notes ?? "",
        startTime: i.startTime,
        durationMinutes: String(i.durationMinutes),
        budgetUsd: String(i.budgetUsd),
      },
      backHref: hrefs.community,
      steps: hrefs.steps,
      reasons,
    };
    // "Plan it here" on this plan's Community step lands here with "?at=<place id>".
    return (
      <Suspense fallback={<CreateScreen {...props} />}>
        <CreateAt {...props} spots={eventSpots(built.view.local.block?.places ?? [])} />
      </Suspense>
    );
  }
  if (step === "event" && planning) return <PlanningScreen state={state} planId={planId} />;
  if (!built || !built.view.concept) return <PlanningScreen state={state} planId={planId} />;

  if (step === "poster") return <PosterScreen view={built.view} live hrefs={{ back: hrefs.event, promote: hrefs.promote, steps: hrefs.steps }} />;
  if (step === "promote") return <PromoteScreen view={built.view} inputs={built.inputs} hrefs={{ back: hrefs.poster, steps: hrefs.steps }} />;
  const marketing = state ? planningSteps(state)[5] : null;
  // Only the plan's owner gets its event stream, or the plan route's word for it; anyone else reads
  // the public view (no budget), and the "Get the OK" drafts carry the budget.
  const owner = feed.phase === "streaming" || feed.phase === "ended" || (feed.phase === "report" && feed.owner);
  return (
    <EventScreen
      view={built.view}
      ask={owner ? askFacts(built.view, built.inputs) : null}
      showBudget={owner}
      hrefs={{ back: hrefs.community, poster: hrefs.poster, steps: hrefs.steps }}
      top={
        marketing?.status === "current" ? (
          <Notice title="Making the poster and the posts">They start on their own once the plan is done. The Poster step shows them when they are ready.</Notice>
        ) : null
      }
    />
  );
}
