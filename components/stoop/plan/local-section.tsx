"use client";

import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import type { ArtistView, LocalView, PlaceView } from "@/lib/plan/view/plan";
import { EmptyNote, PlanSection } from "./plan-section";
import { ReceiptTrigger } from "./receipts";

const FIRST_ARTISTS = 10;
const FIRST_PLACES = 8;

/** A name Qloo returned, as a text button that opens its receipt (the list header says "From Qloo"). */
function NameButton({ name, receiptKey }: { name: string; receiptKey: string | null }) {
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={<span className="font-semibold">{name}</span>}>
      <button
        type="button"
        className="relative rounded-sm text-left font-semibold text-ink underline decoration-dusk decoration-1 underline-offset-4 after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:decoration-2"
      >
        {name}
        <span className="sr-only">, see the receipt</span>
      </button>
    </ReceiptTrigger>
  );
}

function QlooList({ label }: { label: string }) {
  return (
    <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-dusk px-2.5 py-1 text-[0.8125rem] leading-none font-semibold text-paper">
      <BadgeCheck aria-hidden="true" className="size-3.5" />
      {label}
    </p>
  );
}

function MoreToggle({ shown, total, open, onToggle, noun }: { shown: number; total: number; open: boolean; onToggle: () => void; noun: string }) {
  if (total <= shown) return null;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="inline-flex min-h-11 items-center self-start rounded-sm text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-brick"
    >
      {open ? `Show the first ${shown}` : `Show all ${total} ${noun}`}
    </button>
  );
}

function Artists({ artists }: { artists: readonly ArtistView[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? artists : artists.slice(0, FIRST_ARTISTS);
  return (
    <>
      <ol className="grid gap-x-6 sm:grid-cols-2">
        {shown.map((a) => (
          <li key={a.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-2 border-b border-hairline py-2">
            <span className="font-mono text-xs text-ink-soft">#{a.rank}</span>
            <span className="flex min-w-0 flex-col">
              <NameButton name={a.name} receiptKey={a.receipt} />
              {a.genres.length > 0 && <span className="truncate text-xs text-ink-soft">{a.genres.slice(0, 3).join(", ")}</span>}
            </span>
          </li>
        ))}
      </ol>
      <MoreToggle shown={FIRST_ARTISTS} total={artists.length} open={all} onToggle={() => setAll((v) => !v)} noun="artists" />
    </>
  );
}

function Places({ places, inPlan }: { places: readonly PlaceView[]; inPlan: ReadonlySet<string> }) {
  const [all, setAll] = useState(false);
  // The plan's partners first, then Qloo's order.
  const ordered = [...places].sort((a, b) => Number(inPlan.has(b.id)) - Number(inPlan.has(a.id)));
  const shown = all ? ordered : ordered.slice(0, FIRST_PLACES);
  return (
    <>
      <ul className="flex flex-col">
        {shown.map((p) => (
          <li key={p.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-3 border-b border-hairline py-3">
            <span className="pt-0.5 font-mono text-xs text-ink-soft">{p.distanceText ?? ""}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <NameButton name={p.name} receiptKey={p.receipt} />
                <span className="text-xs text-ink-soft">{p.kindLabel}</span>
                {inPlan.has(p.id) && <span className="rounded-full border border-ink px-1.5 py-px text-[0.6875rem] font-semibold">In the plan</span>}
              </p>
              {p.why && <p className="text-sm text-pretty">{p.why}</p>}
            </div>
          </li>
        ))}
      </ul>
      <MoreToggle shown={FIRST_PLACES} total={places.length} open={all} onToggle={() => setAll((v) => !v)} noun="places" />
    </>
  );
}

/**
 * What Qloo measured for this store: the music its city plays (artists ranked by city name, and the
 * styles they share) and the block (places near the store with the distance and Qloo's own "why",
 * the plan's partners first). The city sets the music; the block sets the food and partners.
 */
export function LocalSection({ view, partnerIds, pending }: { view: LocalView; partnerIds: readonly string[]; pending?: boolean }) {
  const { city, block, gaps } = view;
  const inPlan = new Set(partnerIds);
  return (
    <PlanSection
      id="local"
      kicker="What Qloo measured"
      title={city ? `${city.name}, and the block around the store` : "Your city and your block"}
      description="Aggregate taste data for the city by name, and the places around the store. Qloo has no reliable read on a single neighborhood's taste, so Stoop doesn't claim one."
    >
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="local-city" className="flex min-w-0 flex-col gap-3">
          <h3 id="local-city" className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">
            {city ? `What ${city.name} plays` : "City music"}
          </h3>
          {!city ? (
            <EmptyNote>{pending ? "Asking Qloo what this city listens to..." : "No Qloo signal for this city's music."}</EmptyNote>
          ) : (
            <>
              <QlooList label={`Qloo's top artists for adults ${city.ageText}`} />
              <Artists artists={city.artists} />
              {city.styles.length > 0 && (
                <div className="flex flex-col gap-2 pt-2">
                  <p className="text-sm font-semibold">Styles they share</p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {city.styles.map((s) => (
                      <li key={s.name}>
                        <NameButton name={s.name} receiptKey={s.receipt} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
        <section aria-labelledby="local-block" className="flex min-w-0 flex-col gap-3">
          <h3 id="local-block" className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">
            {block ? `The block: ${block.radiusText} around the store` : "The block"}
          </h3>
          {!block ? (
            <EmptyNote>{pending ? "Finding food spots, venues and parks near the store..." : "No Qloo signal for places near this store."}</EmptyNote>
          ) : block.places.length === 0 ? (
            <EmptyNote>No Qloo places within {block.radiusText} of the store.</EmptyNote>
          ) : (
            <>
              <QlooList label="Places Qloo returned, with Qloo's own why" />
              <Places places={block.places} inPlan={inPlan} />
            </>
          )}
        </section>
      </div>
      {gaps.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-soft">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
    </PlanSection>
  );
}
