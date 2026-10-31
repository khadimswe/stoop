"use client";

import { ArrowRight, ChevronLeft, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReceiptView } from "@/lib/report/view/types";
import { eventSpots, planHereHref, type EventSpot } from "@/lib/plan/event-spots";
import { kindCounts, lowerArticle, placeMeta } from "@/lib/plan/view/floor";
import type { LocalView, PlaceView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { BlockMap, type MapPlace } from "./block-map";
import { CommunityAges } from "./community-ages";
import { ActionBar, BUTTON2, BUTTON2_SM, Fine, FloorHeader, FloorMark, IconSlot, NumBadge, PRIMARY, Row, RowGroup, ScreenTitle, Section, TEXT_LINK, type Step } from "./kit";
import { FloorReceipts, OriginTag, ReceiptTrigger } from "./receipts";

const FIRST = 5;
/** The map's "24 places from Qloo" badge ends this far from the map's top: pins are fitted below it. */
const BADGE_BOTTOM = 36;

/** "Plan it here" on a venue or park: the Create step, set to this place (a link, or in place on /start). */
function PlanHere({ p, createHref, onPlanAt }: { p: PlaceView; createHref?: string; onPlanAt?: (spot: EventSpot) => void }) {
  const spot = eventSpots([p])[0];
  if (!spot) return null;
  const label = (
    <>
      Plan it here<span className="sr-only">: {p.name}</span>
    </>
  );
  const className = cn(BUTTON2_SM, "relative z-10 shrink-0");
  if (onPlanAt)
    return (
      <button type="button" onClick={() => onPlanAt(spot)} className={className}>
        {label}
      </button>
    );
  return createHref ? (
    <Link href={planHereHref(createHref, p.id)} className={className}>
      {label}
    </Link>
  ) : null;
}

function PlaceRow({
  p,
  uses,
  picked,
  onPick,
  from,
  planHere,
}: {
  p: PlaceView;
  uses: readonly string[] | undefined;
  picked: boolean;
  onPick: (id: string) => void;
  from: "the store" | "the event";
  planHere?: React.ReactNode;
}) {
  const used = Boolean(uses?.length);
  return (
    <Row
      trail={planHere}
      id={`place-${p.id}`}
      className={cn("scroll-mt-32 transition-colors motion-reduce:transition-none lg:scroll-mt-20", picked && "bg-fl-sunk shadow-[inset_3px_0_0_var(--color-fl-ink)]")}
      lead={<NumBadge n={p.n} on={used} label={`Pin ${p.n}${used ? ", in the plan" : ""}`} />}
      title={
        <button type="button" onClick={() => onPick(p.id)} className="inline-flex min-h-6 items-center text-left after:absolute after:inset-0 after:content-['']" aria-pressed={picked}>
          {p.name}
        </button>
      }
      sub={
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {placeMeta(p, from)}
              {used && <span className="text-fl-ink"> · in the plan: {uses!.join(", ").toLowerCase()}</span>}
            </span>
            <span className="relative z-10">
              <OriginTag origin="qloo" receiptKey={p.receipt} context={p.name} />
            </span>
          </span>
          {p.why && <span className={cn("text-fl-muted", picked ? "" : "line-clamp-1")}>{p.why}</span>}
        </span>
      }
    />
  );
}

/**
 * Step 1, the store's home: its community on a real map, the kind chips, the places (numbered by
 * distance, filled when the plan uses them) and what the city plays. One action: "Create an event";
 * an example store also links to the event it already has. On a phone it is one column (map, chips,
 * list); from 1024 px the list sits in a 440 px column and the map fills the rest of the screen.
 */
export function BlockScreen({
  storeName,
  cityLine,
  address,
  local,
  uses,
  receipts,
  createHref,
  onCreate,
  onPlanAt,
  eventHref,
  steps,
  reasons,
  stepActions,
  storesHref = "/stores",
  fictional,
  notice,
  backHref,
  agesUrl,
}: {
  storeName: string;
  cityLine: string;
  address: string;
  local: LocalView;
  uses: Readonly<Record<string, readonly string[]>>;
  receipts: Readonly<Record<string, ReceiptView>>;
  createHref?: string;
  /** In the /start flow: go on to the form in place instead of a link. */
  onCreate?: () => void;
  /** In the /start flow: "Plan it here" opens the form in place, set to that place. */
  onPlanAt?: (spot: EventSpot) => void;
  /** An example store's (or a live plan's) event, one tap from its community. */
  eventHref?: string;
  steps?: Partial<Record<Step, string>>;
  reasons?: Partial<Record<Step, string>>;
  /** Steps that open in place (the /start flow). */
  stepActions?: Partial<Record<Step, () => void>>;
  storesHref?: string;
  fictional: string | null;
  notice?: React.ReactNode;
  /** In the /start flow, back goes to the store form. */
  backHref?: string;
  /** The plan's "Who loves these spots" route (/api/plan/<id>/ages): fetched after render, shown only with an answer. */
  agesUrl?: string;
}) {
  const block = local.block;
  const [kind, setKind] = useState<PlaceView["kind"] | "all">("all");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const places = useMemo(() => block?.places ?? [], [block]);
  const shown = useMemo(() => places.filter((p) => kind === "all" || p.kind === kind), [places, kind]);
  const list = all ? shown : shown.slice(0, FIRST);
  const mapPlaces = useMemo(
    (): MapPlace[] => shown.map((p) => ({ id: p.id, n: p.n, name: p.name, point: p.point, distanceM: p.distanceM, used: Boolean(uses[p.id]?.length), kindLabel: p.kindLabel, distanceText: p.distanceText, why: p.why })),
    [shown, uses],
  );
  const pick = (id: string) => {
    setPicked(id);
    const p = places.find((x) => x.id === id);
    if (p && !list.includes(p)) {
      if (!shown.includes(p)) setKind("all");
      setAll(true);
    }
    requestAnimationFrame(() => document.getElementById(`place-${id}`)?.scrollIntoView({ block: "nearest" }));
  };
  const street = address.split(",")[0];
  // "Plan it here" needs somewhere to go: the form's link, or the /start flow's form in place.
  const canPlanHere = Boolean(onPlanAt || createHref) && list.some((p) => p.eventSpot);
  // An event away from the store: the community was read around the event's own place.
  const from = block?.from ?? "the store";
  const mapLabel = block ? `Map of ${shown.length} places within ${block.radiusText} of ${from}, numbered by distance` : "";

  const create =
    onCreate || !createHref ? (
      <button type="button" onClick={onCreate} className={PRIMARY}>
        Create an event
      </button>
    ) : (
      <Link href={createHref} className={PRIMARY}>
        Create an event
      </Link>
    );

  const map = (className: string, controls: boolean) =>
    block && places.length > 0 ? (
      <div className={cn("relative", className)}>
        <BlockMap
          center={block.center}
          store={block.store}
          radiusM={block.radiusM}
          places={mapPlaces}
          picked={picked}
          onPick={pick}
          controls={controls}
          insetTop={BADGE_BOTTOM}
          className="h-full"
          label={mapLabel}
        />
        <p className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1 text-xs font-medium">
          <i aria-hidden="true" className="block size-2 rounded-[2px] bg-fl-ink" />
          {kind === "all" ? `${places.length} places from Qloo` : `${shown.length} of ${places.length} places from Qloo`}
        </p>
      </div>
    ) : null;

  return (
    <FloorReceipts receipts={receipts}>
      <FloorHeader
        left={
          backHref ? (
            <IconSlot href={backHref} label="Back to your store">
              <ChevronLeft aria-hidden="true" />
            </IconSlot>
          ) : (
            <IconSlot href="/" label="Stoop home">
              <FloorMark />
            </IconSlot>
          )
        }
        title={storeName}
        subtitle={cityLine}
        store={{ name: storeName, city: cityLine }}
        right={
          <IconSlot href={storesHref} label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
        step="Community"
        hrefs={steps}
        reasons={reasons}
        actions={stepActions}
        storesHref={storesHref}
      />
      <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[488px_minmax(0,1fr)]">
        <main className="mx-auto flex w-full max-w-xl flex-col gap-7 px-4 pt-5 pb-8 lg:mx-0 lg:max-w-none lg:border-r lg:border-fl-rule lg:px-6 lg:pt-8">
          {notice}
          <ScreenTitle
            title="Your community"
            meta={`${street} · ${places.length > 0 ? `Qloo found ${places.length} places near ${from === "the event" ? "the event" : "your store"}, within ${block?.radiusText ?? "about 1 mile"}` : `within ${block?.radiusText ?? "about 1 mile"}`}`}
          />
          {block?.cuisineLine && places.length > 0 && (
            <p className="-mt-5 text-sm text-pretty text-fl-dim">
              {block.cuisineLine}{" "}
              <span className="ml-1 inline-flex align-middle">
                <OriginTag origin="qloo" />
              </span>
            </p>
          )}
          {block?.eventName && (
            <p className="-mt-5 text-[0.8125rem] text-pretty text-fl-dim">
              This event is at {lowerArticle(block.eventName)}, so Qloo searched around it. Your store has its own pin.
            </p>
          )}
          {block && places.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {map("h-[340px] lg:hidden", false)}
              <div role="group" aria-label="Show places of one kind" className="flex flex-wrap gap-2">
                {kindCounts(places).map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    aria-pressed={kind === k.kind}
                    onClick={() => {
                      setKind(k.kind);
                      if (picked && k.kind !== "all" && places.find((p) => p.id === picked)?.kind !== k.kind) setPicked(null);
                    }}
                    className={cn(
                      "h-[34px] shrink-0 rounded-[6px] border px-3 text-sm font-medium whitespace-nowrap",
                      kind === k.kind ? "border-fl-ink bg-fl-ink text-white" : "border-fl-line bg-white text-fl-ink hover:bg-fl-sunk",
                    )}
                  >
                    {k.label} <span className={kind === k.kind ? "text-[#c9ccd1]" : "text-fl-dim"}>{k.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            !notice && <p className="rounded-[20px] bg-white px-4 py-3.5 text-sm text-fl-muted">No Qloo places near this store yet.</p>
          )}

          {shown.length > 0 && (
            <Section
              id="on-the-block"
              title="In your community"
              aside={
                shown.length > FIRST && (
                  <button type="button" onClick={() => setAll((v) => !v)} className={cn(TEXT_LINK, "text-sm")} aria-expanded={all}>
                    {all ? "Show fewer" : `See all ${shown.length}`}
                  </button>
                )
              }
            >
              {canPlanHere && <p className="-mt-1 text-[0.8125rem] text-pretty text-fl-dim">Plan at your door, or take the table to one of these.</p>}
              <RowGroup label="Places in your community" className="[&>li]:relative">
                {list.map((p) => (
                  <PlaceRow
                    key={p.id}
                    p={p}
                    uses={uses[p.id]}
                    picked={picked === p.id}
                    onPick={pick}
                    from={from}
                    planHere={canPlanHere && p.eventSpot ? <PlanHere p={p} createHref={createHref} onPlanAt={onPlanAt} /> : null}
                  />
                ))}
              </RowGroup>
              <Fine>Pin numbers on the map match this list, nearest {from === "the event" ? "the event" : "the store"} first. Black pins are places your event uses.</Fine>
            </Section>
          )}

          {agesUrl && places.length > 0 && <CommunityAges url={agesUrl} from={from} />}

          {local.city && local.city.artists.length > 0 && (
            <Section id="city-plays" title={`What ${local.city.name} plays`} aside={<OriginTag origin="qloo" receiptKey={local.city.artists[0]?.receipt ?? null} context={`what ${local.city.name} plays`} />}>
              <p className="-mt-1.5 text-[0.8125rem] text-fl-dim">Adults {local.city.ageText}</p>
              <RowGroup label={`Artists ${local.city.name} plays`}>
                {local.city.artists.slice(0, 5).map((a, i) => (
                  <Row
                    key={a.id}
                    lead={<NumBadge n={i + 1} />}
                    title={
                      <ReceiptTrigger receiptKey={a.receipt} fallback={a.name}>
                        <button type="button" className="text-left">
                          {a.name}
                          <span className="sr-only">, why Qloo picked this</span>
                        </button>
                      </ReceiptTrigger>
                    }
                  />
                ))}
              </RowGroup>
            </Section>
          )}
          {fictional && <Fine>{fictional}</Fine>}
        </main>
        <div className="hidden lg:sticky lg:top-14 lg:flex lg:h-[calc(100dvh-3.5rem)] lg:flex-col lg:p-4">
          {map("min-h-0 flex-1", true) ?? <div className="flex-1 rounded-[20px] bg-fl-band" />}
          <div className="pointer-events-none absolute right-8 bottom-8 flex items-center gap-3 [&>*]:pointer-events-auto">
            {eventHref && (
              <Link href={eventHref} className={cn(BUTTON2, "h-13 rounded-[12px] px-5")}>
                See this store&apos;s event
              </Link>
            )}
            <div className="[&>*]:w-auto [&>*]:px-6">
              {onCreate || !createHref ? (
                <button type="button" onClick={onCreate} className={PRIMARY}>
                  Create an event <ArrowRight aria-hidden="true" />
                </button>
              ) : (
                <Link href={createHref} className={PRIMARY}>
                  Create an event <ArrowRight aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
      <ActionBar className="lg:hidden">
        {eventHref && (
          <Link href={eventHref} className={cn(TEXT_LINK, "self-center text-sm")}>
            See this store&apos;s event
          </Link>
        )}
        {create}
      </ActionBar>
    </FloorReceipts>
  );
}
