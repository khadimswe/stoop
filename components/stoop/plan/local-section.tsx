"use client";

import { BadgeCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ArtistView, LocalView, PlaceView } from "@/lib/plan/view/plan";
import { OriginTag } from "./origin-tag";
import { ReceiptTrigger } from "./receipts";

const FIRST_ARTISTS = 8;

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
    <section aria-label={`Playlist from ${city}`} className="flex flex-col gap-2">
      <Heading>Playlist from {city}</Heading>
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

const GROUPS: { kind: PlaceView["kind"]; label: string }[] = [
  { kind: "food", label: "Food" },
  { kind: "venue", label: "Venues" },
  { kind: "park", label: "Parks" },
  { kind: "shop", label: "Shops" },
  { kind: "other", label: "Other" },
];
const FIRST_PER_GROUP = 4;

function PlaceGroup({ label, places, uses }: { label: string; places: readonly PlaceView[]; uses: Readonly<Record<string, readonly string[]>> }) {
  const [all, setAll] = useState(false);
  // The plan's places first, then Qloo's order.
  const ordered = [...places].sort((a, b) => Number(Boolean(uses[b.id])) - Number(Boolean(uses[a.id])));
  const shown = all ? ordered : ordered.slice(0, FIRST_PER_GROUP);
  return (
    <section aria-label={label} className="flex flex-col">
      <h4 className="font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">{label}</h4>
      <ul className="flex flex-col">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-col gap-1.5 border-b border-hairline py-2.5 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-semibold">{p.name}</span>
              {p.distanceText && <span className="font-mono text-xs text-ink-soft">{p.distanceText}</span>}
              {p.chain && <span className="text-xs text-ink-soft">Chain</span>}
              {uses[p.id] && <span className="rounded-full border border-ink px-1.5 text-[0.6875rem] font-semibold">In the plan</span>}
            </p>
            <div>
              <OriginTag origin="qloo" receiptKey={p.receipt} context={p.name} />
            </div>
          </li>
        ))}
      </ul>
      <MoreToggle shown={FIRST_PER_GROUP} total={places.length} open={all} onToggle={() => setAll((v) => !v)} />
    </section>
  );
}

function Places({ places, uses, radiusText }: { places: readonly PlaceView[]; uses: Readonly<Record<string, readonly string[]>>; radiusText: string }) {
  return (
    <section aria-label="Places nearby" className="flex flex-col gap-3">
      <Heading>Places within {radiusText}</Heading>
      {GROUPS.map((g) => {
        const group = places.filter((p) => p.kind === g.kind);
        return group.length > 0 ? <PlaceGroup key={g.kind} label={g.label} places={group} uses={uses} /> : null;
      })}
    </section>
  );
}

/**
 * What Qloo measured around the store, one tap deep: the places nearby grouped by kind (the plan's
 * first, each with its receipt) and the city's playlist. A plain list: no map drawing.
 */
export function YourBlock({ view, uses }: { view: LocalView; uses: Readonly<Record<string, readonly string[]>> }) {
  const { city, block, gaps, blockMusic } = view;
  return (
    <div className="flex flex-col gap-6">
      {blockMusic && blockMusic.places[0] && (
        <p className="text-sm text-pretty">
          People who love <NameButton name={blockMusic.places[0].name} receiptKey={blockMusic.places[0].receipt} /> also play{" "}
          {blockMusic.artists.slice(0, 3).map((a, i, list) => (
            <span key={a.name}>
              <NameButton name={a.name} receiptKey={a.receipt} />
              {i < list.length - 2 ? ", " : i === list.length - 2 ? " and " : "."}
            </span>
          ))}
        </p>
      )}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        {block && block.places.length > 0 ? <Places places={block.places} uses={uses} radiusText={block.radiusText} /> : <p className="text-sm text-ink-soft">No Qloo places near the store.</p>}
        {city ? <Artists city={city.name} artists={city.artists} /> : <p className="text-sm text-ink-soft">No Qloo signal for a playlist.</p>}
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
