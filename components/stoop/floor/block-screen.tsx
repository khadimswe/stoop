"use client";

import { ChevronLeft, LayoutGrid } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReceiptView } from "@/lib/report/view/types";
import { kindCounts, placeMeta } from "@/lib/plan/view/floor";
import type { LocalView, PlaceView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { BlockMap } from "./block-map";
import { ActionBar, AppBar, Fine, FloorMark, IconSlot, NumBadge, PRIMARY, Row, RowGroup, ScreenBody, ScreenTitle, Section, Stepper, TEXT_LINK } from "./kit";
import { FloorReceipts, OriginTag, ReceiptTrigger } from "./receipts";

const FIRST = 5;

function PlaceRow({ p, used, picked, onPick }: { p: PlaceView; used: boolean; picked: boolean; onPick: (id: string) => void }) {
  return (
    <Row
      id={`place-${p.id}`}
      className={cn("scroll-mt-32 transition-colors motion-reduce:transition-none", picked && "bg-fl-sunk")}
      lead={<NumBadge n={p.n} on={used} label={`Pin ${p.n}${used ? ", in the plan" : ""}`} />}
      title={
        <button type="button" onClick={() => onPick(p.id)} className="text-left" aria-pressed={picked}>
          {p.name}
        </button>
      }
      sub={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{placeMeta(p)}</span>
          <OriginTag origin="qloo" receiptKey={p.receipt} context={p.name} />
        </span>
      }
    />
  );
}

/**
 * Step 1, the store's home: the block on a real map, the kind chips, the nearest places (numbered by
 * distance, filled when the plan uses them) and what the city plays. One action: "Create an event".
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
  storesHref = "/stores",
  fictional,
  notice,
  backHref,
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
  storesHref?: string;
  fictional: string | null;
  notice?: React.ReactNode;
  /** In the /start flow, back goes to the store form. */
  backHref?: string;
}) {
  const block = local.block;
  const [kind, setKind] = useState<PlaceView["kind"] | "all">("all");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const places = useMemo(() => block?.places ?? [], [block]);
  const shown = places.filter((p) => kind === "all" || p.kind === kind);
  const list = all ? shown : shown.slice(0, FIRST);
  const pick = (id: string) => {
    setPicked(id);
    const p = places.find((x) => x.id === id);
    if (p && !list.includes(p)) {
      setKind("all");
      setAll(true);
    }
    requestAnimationFrame(() => document.getElementById(`place-${id}`)?.scrollIntoView({ block: "nearest" }));
  };
  const street = address.split(",")[0];

  return (
    <FloorReceipts receipts={receipts}>
      <AppBar
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
        right={
          <IconSlot href={storesHref} label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
      />
      <Stepper current="Block" />
      <ScreenBody>
        {notice}
        <ScreenTitle title="Your block" meta={`${street} · within ${block?.radiusText ?? "1.5 km"}`} />
        {block && places.length > 0 ? (
          <div className="flex flex-col gap-3.5">
            <div className="relative">
              <BlockMap
                center={block.center}
                radiusM={block.radiusM}
                places={places.map((p) => ({ id: p.id, n: p.n, name: p.name, point: p.point, distanceM: p.distanceM, used: Boolean(uses[p.id]) }))}
                picked={picked}
                onPick={pick}
                className="h-[340px]"
                label={`Map of ${places.length} places within ${block.radiusText} of the store, numbered by distance`}
              />
              <p className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1 text-xs font-medium">
                <i aria-hidden="true" className="block size-2 rounded-[2px] bg-fl-ink" />
                {places.length} places from Qloo
              </p>
            </div>
            <div role="group" aria-label="Show places of one kind" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
              {kindCounts(places).map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  aria-pressed={kind === k.kind}
                  onClick={() => setKind(k.kind)}
                  className={cn(
                    "h-[34px] shrink-0 rounded-[6px] border px-3 text-sm font-medium whitespace-nowrap",
                    kind === k.kind ? "border-fl-ink bg-fl-ink text-white" : "border-fl-line bg-white text-fl-ink",
                  )}
                >
                  {k.label} <span className={kind === k.kind ? "text-[#c9ccd1]" : "text-fl-dim"}>{k.count}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-[20px] bg-white px-4 py-3.5 text-sm text-fl-muted">No Qloo places near this store yet.</p>
        )}

        {shown.length > 0 && (
          <Section
            id="on-the-block"
            title="On the block"
            aside={
              shown.length > FIRST && (
                <button type="button" onClick={() => setAll((v) => !v)} className={cn(TEXT_LINK, "text-sm")} aria-expanded={all}>
                  {all ? "Show fewer" : `See all ${shown.length}`}
                </button>
              )
            }
          >
            <RowGroup label="Places on the block">
              {list.map((p) => (
                <PlaceRow key={p.id} p={p} used={Boolean(uses[p.id])} picked={picked === p.id} onPick={pick} />
              ))}
            </RowGroup>
          </Section>
        )}

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
      </ScreenBody>
      <ActionBar>
        {onCreate || !createHref ? (
          <button type="button" onClick={onCreate} className={PRIMARY}>
            Create an event
          </button>
        ) : (
          <Link href={createHref} className={PRIMARY}>
            Create an event
          </Link>
        )}
      </ActionBar>
    </FloorReceipts>
  );
}
