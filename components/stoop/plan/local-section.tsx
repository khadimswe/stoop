"use client";

import { BadgeCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ArtistView, LocalView, PlaceView } from "@/lib/plan/view/plan";
import { ReceiptTrigger } from "./receipts";

const FIRST_ARTISTS = 8;
const FIRST_PLACES = 6;

/** A name Qloo returned, as a text button that opens its receipt. */
function NameButton({ name, receiptKey }: { name: string; receiptKey: string | null }) {
  return (
    <ReceiptTrigger receiptKey={receiptKey} fallback={<span className="font-semibold">{name}</span>}>
      <button
        type="button"
        className="relative rounded-sm text-left font-semibold text-ink underline decoration-dusk decoration-1 underline-offset-4 after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] hover:decoration-2"
      >
        {name}
        <span className="sr-only">, why Qloo picked this</span>
      </button>
    </ReceiptTrigger>
  );
}

function MoreToggle({ shown, total, open, onToggle }: { shown: number; total: number; open: boolean; onToggle: () => void }) {
  if (total <= shown) return null;
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-brick">
      {open ? "Show fewer" : `Show all ${total}`}
    </button>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      {children}
      <span className="inline-flex items-center gap-1 font-mono text-[0.6875rem] font-normal text-dusk">
        <BadgeCheck aria-hidden="true" className="size-3.5" />
        Qloo
      </span>
    </h3>
  );
}

function Artists({ city, artists }: { city: string; artists: readonly ArtistView[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? artists : artists.slice(0, FIRST_ARTISTS);
  return (
    <section aria-label={`Music in ${city}`} className="flex flex-col gap-2">
      <Heading>Music in {city}</Heading>
      <ol className="grid grid-cols-2 gap-x-4">
        {shown.map((a) => (
          <li key={a.id} className="flex items-baseline gap-2 border-b border-hairline py-1.5 text-sm">
            <span className="w-6 shrink-0 font-mono text-xs text-ink-soft">{a.rank}</span>
            <NameButton name={a.name} receiptKey={a.receipt} />
          </li>
        ))}
      </ol>
      <MoreToggle shown={FIRST_ARTISTS} total={artists.length} open={all} onToggle={() => setAll((v) => !v)} />
    </section>
  );
}

function Places({ places, inPlan, radiusText }: { places: readonly PlaceView[]; inPlan: ReadonlySet<string>; radiusText: string }) {
  const [all, setAll] = useState(false);
  // The plan's partners first, then Qloo's order.
  const ordered = [...places].sort((a, b) => Number(inPlan.has(b.id)) - Number(inPlan.has(a.id)));
  const shown = all ? ordered : ordered.slice(0, FIRST_PLACES);
  return (
    <section aria-label="Places nearby" className="flex flex-col gap-2">
      <Heading>Places within {radiusText}</Heading>
      <ul className="flex flex-col">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-col gap-0.5 border-b border-hairline py-2.5 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <NameButton name={p.name} receiptKey={p.receipt} />
              {p.distanceText && <span className="font-mono text-xs text-ink-soft">{p.distanceText}</span>}
              {inPlan.has(p.id) && <span className="rounded-full border border-ink px-1.5 text-[0.6875rem] font-semibold">In the plan</span>}
            </p>
            {p.why && <p className="line-clamp-2 text-ink-soft">{p.why}</p>}
          </li>
        ))}
      </ul>
      <MoreToggle shown={FIRST_PLACES} total={places.length} open={all} onToggle={() => setAll((v) => !v)} />
    </section>
  );
}

/**
 * What Qloo measured around the store, one tap deep: the city's artists (by city name) and the places
 * nearby with Qloo's own "why", the plan's partners first.
 */
export function YourBlock({ view, partnerIds, map }: { view: LocalView; partnerIds: readonly string[]; map?: ReactNode }) {
  const { city, block, gaps } = view;
  const inPlan = new Set(partnerIds);
  return (
    <div className="flex flex-col gap-6">
      {map}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        {block && block.places.length > 0 ? <Places places={block.places} inPlan={inPlan} radiusText={block.radiusText} /> : <p className="text-sm text-ink-soft">No Qloo places near the store.</p>}
        {city ? <Artists city={city.name} artists={city.artists} /> : <p className="text-sm text-ink-soft">No Qloo signal for city music.</p>}
      </div>
      {gaps.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-ink-soft">
          {gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
