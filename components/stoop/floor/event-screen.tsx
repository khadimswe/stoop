import { ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { eventStats, foldMeta, judgeView, playView, prizesLine, snacksView } from "@/lib/plan/view/floor";
import type { PlanView, TextPart } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { BlockMap } from "./block-map";
import { ActionBar, AppBar, Fine, IconSlot, NumBadge, PRIMARY, Row, RowGroup, ScreenBody, ScreenTitle, Section, StatStrip, Stepper, type Step } from "./kit";
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

/**
 * Step 3, the event: when, the name and the hook, three numbers, then a jump row to Play, Snacks,
 * Wheel and Timeline. Before the day and the shopping list fold; the judges' material sits folded at
 * the very end. One action: "See the poster".
 */
export function EventScreen({
  view,
  hrefs,
  top,
  running = false,
}: {
  view: PlanView;
  hrefs: { back: string; poster: string; steps: Partial<Record<Step, string>> };
  top?: ReactNode;
  running?: boolean;
}) {
  const play = playView(view);
  const snacks = snacksView(view);
  const prizes = prizesLine(view);
  const fold = foldMeta(view);
  const judge = judgeView(view);
  const snackPlaces = new Set(snacks.items.flatMap((s) => (s.from ? [s.from.name] : [])));
  const block = view.local.block;
  const mapPlaces = block?.places.filter((p) => snackPlaces.has(p.name)) ?? [];
  const jumps = JUMPS.filter((j) => j.id !== "wheel" || view.wheel);

  return (
    <FloorReceipts receipts={view.receipts}>
      <AppBar
        left={
          <IconSlot href={hrefs.back} label="Back to the block">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="The event"
      />
      <Stepper current="Event" hrefs={hrefs.steps} />
      <OpenOnHash />
      <ScreenBody>
        {top}
        <div className="flex flex-col gap-2">
          <ScreenTitle eyebrow={`${view.header.dateShort} · ${view.header.timeText}`} title={view.concept?.title ?? view.header.storeName} />
          {view.concept && <p className="text-[0.9375rem] leading-[22px] text-pretty text-fl-muted">{view.concept.hook}</p>}
          {view.header.venue && <p className="text-[0.8125rem] text-fl-dim">At {view.header.venue}</p>}
        </div>
        {view.concept && <StatStrip label="The event in numbers" stats={eventStats(view)} />}

        {view.concept && (
          <nav aria-label="Jump to" className="-mx-4 -my-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
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

        {snacks.items.length > 0 && (
          <Section id="snacks" title="Snacks" aside={snacks.totalText && <span className="tabular-nums">{snacks.totalText}</span>}>
            <div className="overflow-hidden rounded-[20px] bg-white">
              {block && mapPlaces.length > 0 && (
                <BlockMap
                  center={block.center}
                  radiusM={block.radiusM}
                  places={mapPlaces.map((p) => ({ id: p.id, n: p.n, name: p.name, point: p.point, distanceM: p.distanceM, used: true }))}
                  interactive={false}
                  className="h-[150px] rounded-none"
                  label={`Map of the snack spots: ${mapPlaces.map((p) => `${p.name}, ${p.distanceText}`).join("; ")}`}
                />
              )}
              <ul className="[&>li+li]:border-t [&>li+li]:border-fl-rule">
                {snacks.items.map((s, i) => (
                  <Row
                    key={`${s.item}-${i}`}
                    lead={s.from ? <NumBadge n={s.from.n} on /> : <NumBadge dashed />}
                    title={s.item}
                    sub={
                      s.from ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>
                            {s.from.name}
                            {s.from.distanceText && ` · ${s.from.distanceText}`}
                          </span>
                          <OriginTag origin="qloo" receiptKey={s.from.receipt} context={s.from.name} />
                        </span>
                      ) : (
                        <OriginTag origin={s.origin} />
                      )
                    }
                    trail={s.costText && <span className="text-[0.9375rem] tabular-nums">{s.costText}</span>}
                  />
                ))}
              </ul>
            </div>
          </Section>
        )}

        {view.wheel && (
          <Section id="wheel" title="Wheel" aside={view.wheel.rules[0] && <span className="max-w-[14rem] truncate">{view.wheel.rules[0].replace(/\. .*$/, "")}</span>}>
            <RowGroup label="Put these on your wheel">
              {view.wheel.slices.map((s) => (
                <Row
                  key={s.n}
                  lead={<NumBadge n={s.n} on={s.kind !== "promo"} />}
                  title={s.label}
                  sub={
                    <span className="flex flex-col gap-1">
                      {s.text !== s.label && (
                        <span className="text-xs">
                          <Text parts={s.parts} />
                        </span>
                      )}
                      <OriginTag origin={s.origin} receiptKey={s.receipt} extra={s.place?.distanceText ?? undefined} context={s.label} />
                    </span>
                  }
                />
              ))}
            </RowGroup>
            {prizes && <Fine>{prizes}</Fine>}
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
                        <span className="block text-[0.8125rem] text-fl-dim">
                          {[s.qty, s.from ? `from ${s.from.name}` : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{s.costText}</span>
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
      </ScreenBody>
      <ActionBar>
        <Link href={hrefs.poster} className={PRIMARY} aria-disabled={!view.concept} tabIndex={view.concept ? undefined : -1}>
          See the poster
        </Link>
      </ActionBar>
    </FloorReceipts>
  );
}
