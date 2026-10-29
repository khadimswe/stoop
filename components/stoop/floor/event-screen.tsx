import { ArrowRight, ChevronDown, ChevronLeft, LayoutGrid } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { about, budgetView, eventStats, foldMeta, judgeView, playView, prizesView, snackGroups, venueLine } from "@/lib/plan/view/floor";
import type { PlanView, TextPart } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { BlockMap, type MapPlace } from "./block-map";
import { ExampleNotice } from "./example-notice";
import { ActionBar, Fine, FloorHeader, IconSlot, NumBadge, PRIMARY, Row, RowGroup, ScreenTitle, Section, StatStrip, TwoColumn, type Step } from "./kit";
import { FloorReceipts, OpenOnHash, OriginTag } from "./receipts";

/** Plan text with measured names in plain ink (their receipt is on the line's own tag). */
function Text({ parts }: { parts: readonly TextPart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.kind === "text" ? <span key={i}>{p.text}</span> : <span key={i}>{p.name}</span>))}
    </>
  );
}

/** A closed-by-default row that opens in place (native details). */
function Fold({ title, meta, children, id }: { title: string; meta?: string; children: ReactNode; id?: string }) {
  return (
    <details id={id} className="group/f scroll-mt-28">
      <summary className="flex min-h-[54px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] leading-5 font-medium">{title}</span>
          {meta && <span className="mt-px block text-[0.8125rem] leading-[18px] text-fl-dim">{meta}</span>}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-fl-chev transition-transform group-open/f:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-fl-rule px-4 py-3">{children}</div>
    </details>
  );
}

const JUMPS = [
  { id: "play", label: "Play" },
  { id: "snacks", label: "Snacks" },
  { id: "wheel", label: "Wheel" },
  { id: "timeline", label: "Timeline" },
] as const;

/** The places the plan uses, for the mini map: fitted with the store, each with its name. */
function usedPlaces(view: PlanView): MapPlace[] {
  return (view.local.block?.places ?? [])
    .filter((p) => view.placeUses[p.id]?.length)
    .map((p) => ({ id: p.id, n: p.n, name: p.name, point: p.point, distanceM: p.distanceM, used: true, kindLabel: p.kindLabel, distanceText: p.distanceText, why: p.why }));
}

function MiniMap({ view, className }: { view: PlanView; className: string }) {
  const block = view.local.block;
  const places = usedPlaces(view);
  if (!block || places.length === 0) return null;
  return (
    <BlockMap
      center={block.center}
      radiusM={block.radiusM}
      places={places}
      interactive={false}
      labels="all"
      className={className}
      label={`Map of the places the plan uses: ${places.map((p) => `${p.n}, ${p.name}, ${p.distanceText ?? "near"}`).join("; ")}`}
    />
  );
}

/**
 * Step 3, the event: when, the name and the hook, three numbers, then a jump row to Play, Snacks,
 * Wheel and Timeline. Before the day and the shopping list fold; the judges' material sits folded at
 * the very end. One action: "See the poster". From 1024 px a side column keeps the poster, the map of
 * the places the plan uses, the budget and that action in view.
 */
export function EventScreen({
  view,
  hrefs,
  top,
  running = false,
  exampleSlug,
  reasons,
  storesHref = "/stores",
}: {
  view: PlanView;
  hrefs: { back: string; poster: string; steps: Partial<Record<Step, string>> };
  top?: ReactNode;
  running?: boolean;
  /** An example store: says so at the top when it stands in for a live plan. */
  exampleSlug?: string;
  reasons?: Partial<Record<Step, string>>;
  storesHref?: string;
}) {
  const play = playView(view);
  const groups = snackGroups(view);
  const prizes = prizesView(view);
  const fold = foldMeta(view);
  const judge = judgeView(view);
  const budget = budgetView(view);
  const snacksTotal = groups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + (i.usd ?? 0), 0), 0);
  const jumps = JUMPS.filter((j) => j.id !== "wheel" || view.wheel);
  const stats = eventStats(view).map((s, i) => (i === 0 ? { ...s, label: `${s.label}, estimated` } : s));
  const poster = view.concept ? view.marketing.poster.thumb : null;
  const primary = (
    <Link href={hrefs.poster} className={PRIMARY} aria-disabled={!view.concept} tabIndex={view.concept ? undefined : -1}>
      See the poster
    </Link>
  );

  const main = (
    <>
      {top}
      {exampleSlug && <ExampleNotice slug={exampleSlug} storeName={view.header.storeName} cityLine={view.header.cityLine} />}
      <div className="flex flex-col gap-2">
        <ScreenTitle eyebrow={`${view.header.dateShort} · ${view.header.timeText}`} title={view.concept?.title ?? view.header.storeName} />
        {view.concept && <p className="max-w-[60ch] text-[0.9375rem] leading-[22px] text-pretty text-fl-muted">{view.concept.hook}</p>}
        {view.header.venue && <p className="text-[0.8125rem] text-fl-dim">{venueLine(view.header.venue)}</p>}
      </div>
      {view.concept && <StatStrip label="The event in numbers" stats={stats} />}

      {view.concept && (
        <nav aria-label="Jump to" className="-mx-4 -my-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:px-0">
          {jumps.map((j) => (
            <a key={j.id} href={`#${j.id}`} className="inline-flex h-[34px] shrink-0 items-center rounded-[6px] border border-fl-line bg-white px-3 text-sm font-medium hover:bg-fl-sunk">
              {j.label}
            </a>
          ))}
        </nav>
      )}

      {running && !view.concept && <p className="text-sm text-fl-dim">The plan fills in as Qloo answers.</p>}

      {play.artists.length > 0 && (
        <Section id="play" title="Play" aside={<OriginTag origin="qloo" receiptKey={play.receipt} context="the playlist" openOnHash="receipt-play" />}>
          <RowGroup label="Playlist">
            {play.artists.map((name, i) => (
              <Row key={name} lead={<NumBadge n={i + 1} />} title={name} />
            ))}
          </RowGroup>
          {play.note && <Fine>{play.note}</Fine>}
        </Section>
      )}

      {groups.length > 0 && (
        <Section id="snacks" title="Snacks" aside={snacksTotal > 0 && <span className="tabular-nums">about ${snacksTotal}</span>}>
          <div className="overflow-hidden rounded-[20px] bg-white">
            <MiniMap view={view} className="h-[180px] rounded-none lg:hidden" />
            <ul aria-label="Snacks by place" className="[&>li+li]:border-t [&>li+li]:border-fl-rule">
              {groups.map((g, gi) => (
                <li key={g.place?.name ?? `none-${gi}`} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {g.place ? <NumBadge n={g.place.n} on label={`Pin ${g.place.n}`} /> : <NumBadge dashed />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.9375rem] leading-5 font-medium">{g.place ? g.place.name : "From any store"}</p>
                      <p className="mt-px flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] leading-[18px] text-fl-dim">
                        {g.place ? (
                          <>
                            {g.place.distanceText && <span>{g.place.distanceText} away</span>}
                            <OriginTag origin="qloo" receiptKey={g.place.receipt} context={g.place.name} />
                          </>
                        ) : (
                          <OriginTag origin={g.items[0]?.origin ?? "creative"} />
                        )}
                      </p>
                    </div>
                  </div>
                  <ul className="flex flex-col gap-1 pl-9">
                    {g.items.map((s, i) => (
                      <li key={`${s.item}-${i}`} className="flex items-baseline justify-between gap-3 text-sm leading-5 text-fl-muted">
                        <span className="min-w-0 text-pretty">
                          {s.item}
                          {s.qty && <span className="text-fl-dim"> · {s.qty}</span>}
                        </span>
                        {s.costText && <span className="shrink-0 text-fl-ink tabular-nums">{about(s.costText)}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <Fine>Pin numbers match the Community map. Prices are the plan&apos;s estimates.</Fine>
        </Section>
      )}

      {view.wheel && (
        <Section id="wheel" title="Wheel" aside={view.wheel.rules[0] && <span className="max-w-[14rem] truncate">{view.wheel.rules[0].replace(/\. .*$/, "")}</span>}>
          <RowGroup label="Put these on your wheel">
            {view.wheel.slices.map((s) => (
              <Row
                key={s.n}
                lead={<NumBadge n={s.n} on={s.origin === "qloo" || s.origin === "interpreted"} dashed={s.origin === "creative"} label={`Slice ${s.n}`} />}
                title={s.label}
                sub={
                  <span className="flex flex-col gap-1">
                    {s.text !== s.label && (
                      <span className="text-xs">
                        <Text parts={s.parts} />
                      </span>
                    )}
                    <OriginTag origin={s.origin} receiptKey={s.receipt} extra={s.place ? `pin ${s.place.n}${s.place.distanceText ? `, ${s.place.distanceText}` : ""}` : undefined} context={s.label} />
                  </span>
                }
              />
            ))}
          </RowGroup>
          {prizes && (
            <div className="flex flex-col gap-1 px-1">
              <p className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-semibold">
                Prizes on the shopping list <span className="font-normal text-fl-dim tabular-nums">about {prizes.totalText}</span>
              </p>
              <ul className="flex flex-col gap-0.5 text-[0.8125rem] leading-[18px] text-fl-dim">
                {prizes.items.map((p, i) => (
                  <li key={`${p.item}-${i}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">{p.item}</span>
                    {p.costText && <span className="shrink-0 tabular-nums">{about(p.costText)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {view.runOfShow.length > 0 && (
        <Section id="timeline" title="Timeline" aside={`${view.runOfShow.length} steps`}>
          <ol className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            {view.runOfShow.map((s, i) => (
              <li key={`${s.time}-${i}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2 px-4 py-[11px]">
                <time dateTime={s.time} className="text-sm font-semibold tabular-nums">
                  {s.clock}
                </time>
                <p className="text-sm leading-5 text-pretty text-fl-muted">
                  {s.label && <b className="font-semibold text-fl-ink">{s.label}. </b>}
                  <Text parts={s.rest} />
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {(view.checklist.length > 0 || view.shopping.length > 0) && (
        <div className="overflow-hidden rounded-[20px] bg-white [&>details+details]:border-t [&>details+details]:border-fl-rule">
          {view.checklist.length > 0 && (
            <Fold title="Before the day" meta={fold.checklist}>
              <ul className="flex flex-col">
                {view.checklist.map((parts, i) => (
                  <li key={i}>
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-5 text-pretty">
                      <input type="checkbox" className="mt-0.5 size-5 shrink-0 cursor-pointer accent-fl-ink" />
                      <span>
                        <Text parts={parts} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
          {view.shopping.length > 0 && (
            <Fold title="Shopping list" meta={fold.shopping}>
              <ul className="flex flex-col">
                {view.shopping.map((s, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 border-b border-fl-rule py-2 text-sm last:border-b-0">
                    <span className="min-w-0">
                      <span className="block">{s.item}</span>
                      <span className="block text-[0.8125rem] text-fl-dim">{[s.qty, s.from ? `from ${s.from.name} (pin ${s.from.n})` : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{about(s.costText)}</span>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="ml-0.5 text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">For judges</p>
        <div className="overflow-hidden rounded-[20px] bg-white [&>details+details]:border-t [&>details+details]:border-fl-rule">
          {judge && (
            <Fold title="Compare with a generic AI plan" id="compare">
              <div className="-mx-4 -mt-3 flex flex-col">
                <dl className="grid grid-cols-3 border-b border-fl-rule">
                  {judge.stats.map((s, i) => (
                    <div key={i} className={cn("flex flex-col-reverse px-4 py-3", i > 0 && "border-l border-fl-rule")}>
                      <dt className="text-[0.8125rem] text-fl-dim">{s.label}</dt>
                      <dd className="text-[1.375rem] leading-[26px] font-medium tabular-nums">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 text-sm leading-5">
                  {judge.pairs.map((pair, i) => (
                    <div key={i} className="contents">
                      <dt className="text-fl-dim">Generic</dt>
                      <dd className="text-fl-dim">{pair.generic}</dd>
                      {pair.stoop && (
                        <>
                          <dt className="font-semibold">Stoop</dt>
                          <dd className="mb-2">{pair.stoop}</dd>
                        </>
                      )}
                    </div>
                  ))}
                </dl>
                {judge.lines.length > 0 && (
                  <ul className="flex flex-col gap-1 border-t border-fl-rule px-4 py-3 text-[0.8125rem] text-fl-muted">
                    {judge.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Fold>
          )}
          <Fold title="How it was made" meta={`${view.trace.length} steps · ${view.calls.live + view.calls.cached} Qloo calls`} id="how-it-was-made">
            <ol aria-label="Agent steps" className="flex flex-col">
              {view.trace.map((t) => (
                <li key={t.key} className="flex flex-col gap-0.5 border-b border-fl-rule py-2 text-sm last:border-b-0">
                  {t.startsGroup && <span className="text-[0.6875rem] font-semibold tracking-[0.04em] text-fl-dim uppercase">{t.stageLabel}</span>}
                  <span className={t.kind === "decision" ? "font-medium" : "text-fl-muted"}>
                    <span className="sr-only">{t.kind === "decision" ? "Agent decision: " : "Qloo call: "}</span>
                    {t.label}
                  </span>
                  {t.reason && <span className="text-[0.8125rem] text-fl-dim">{t.reason}</span>}
                  {t.served && <span className="text-xs text-fl-dim">{t.served === "cached" ? "From cache" : "Live call"}</span>}
                </li>
              ))}
            </ol>
          </Fold>
        </div>
      </div>
      {view.header.fictional && <Fine>{view.header.fictional}</Fine>}
    </>
  );

  const side = (
    <>
      {poster && (
        <Link href={hrefs.poster} className="group flex items-center gap-4 rounded-[20px] bg-white p-3 hover:bg-fl-sunk">
          <span className="w-[96px] shrink-0 rounded-[8px] bg-fl-dark p-1.5">
            <Image src={poster} alt="" width={180} height={225} unoptimized className="aspect-[4/5] h-auto w-full rounded-[4px] object-cover object-top" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold">Poster</span>
            <span className="text-[0.8125rem] text-fl-dim">Portrait 4:5 and wide 1.91:1, made from this plan</span>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline decoration-1 underline-offset-[3px] group-hover:decoration-2">
              Open the poster <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          </span>
        </Link>
      )}
      {usedPlaces(view).length > 0 && (
        <section aria-labelledby="side-map-h" className="overflow-hidden rounded-[20px] bg-white">
          <MiniMap view={view} className="h-[220px] rounded-none" />
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <h2 id="side-map-h" className="text-[0.9375rem] font-semibold">
              {usedPlaces(view).length === 1 ? "The community place it uses" : `The ${usedPlaces(view).length} community places it uses`}
            </h2>
            <p className="text-[0.8125rem] text-fl-dim">Same pin numbers as the Community map.</p>
          </div>
        </section>
      )}
      {view.shopping.length > 0 && (
        <section aria-labelledby="side-budget-h" className="flex flex-col gap-2 rounded-[20px] bg-white px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="side-budget-h" className="text-[0.9375rem] font-semibold">
              Budget
            </h2>
            <p className="text-[0.9375rem] tabular-nums">
              about {budget.spentText} <span className="text-fl-dim">of {budget.budgetText}</span>
            </p>
          </div>
          <dl className="flex flex-col gap-1 text-[0.8125rem]">
            {budget.rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-3">
                <dt className="text-fl-dim">{r.label}</dt>
                <dd className="tabular-nums">about {r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {primary}
    </>
  );

  return (
    <FloorReceipts receipts={view.receipts}>
      <FloorHeader
        left={
          <IconSlot href={hrefs.back} label="Back to your community">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="The event"
        right={
          <IconSlot href={storesHref} label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
        store={{ name: view.header.storeName, city: view.header.cityLine }}
        step="Event"
        hrefs={hrefs.steps}
        reasons={reasons}
        storesHref={storesHref}
      />
      <OpenOnHash />
      <TwoColumn main={main} side={side} />
      <ActionBar className="lg:hidden">{primary}</ActionBar>
    </FloorReceipts>
  );
}
