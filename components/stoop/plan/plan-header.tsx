import { BadgeCheck, Disc3, Megaphone, Music, Sandwich, Gift } from "lucide-react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/stoop/provenance-badge";
import type { ConceptView, PlanHeaderView, TileView } from "@/lib/plan/view/plan";

const TILE_ICONS = { music: Music, snacks: Sandwich, wheel: Disc3, post: Megaphone } as const;

function Tile({ tile }: { tile: TileView }) {
  const Icon = tile.key === "wheel" && tile.label === "Giveaway" ? Gift : TILE_ICONS[tile.key];
  return (
    <li>
      <a href={tile.href} className="flex h-full min-h-28 flex-col gap-1.5 rounded-xl border border-hairline bg-surface p-3.5 hover:border-concrete-line sm:p-4">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon aria-hidden="true" className="size-4" />
            {tile.label}
          </span>
          {tile.qloo && (
            <span className="inline-flex items-center gap-1 font-mono text-[0.6875rem] text-dusk">
              <BadgeCheck aria-hidden="true" className="size-3.5" />
              Qloo
            </span>
          )}
        </span>
        <span className="line-clamp-2 font-display text-[1.0625rem] leading-tight font-bold text-pretty [font-stretch:90%]">{tile.value}</span>
        {tile.note && <span className="mt-auto text-xs text-ink-soft">{tile.note}</span>}
      </a>
    </li>
  );
}

/**
 * The first screen of a plan: the store, the event's name, when and where, four tiles for what to do
 * (music, snacks, the wheel, posting) and the store's promos quoted exactly. Everything else is one
 * tap deeper. Example stores say they are fictional; no carrier logo, ever.
 */
export function PlanHeader({ view, kind, concept, tiles }: { view: PlanHeaderView; kind: "live" | "example"; concept: ConceptView | null; tiles: readonly TileView[] }) {
  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {kind === "example" ? (
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
              <li>
                <Link href="/#examples" className="underline decoration-1 underline-offset-4 hover:text-ink hover:decoration-brick">
                  Examples
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">
                {view.storeName}, {view.cityLine.split(",")[0]}
              </li>
            </ol>
          </nav>
        ) : (
          <p className="text-sm text-ink-soft">
            {view.storeName}, {view.cityLine.split(",")[0]}
          </p>
        )}
        <h1 className="font-display text-[1.75rem] leading-[1.05] font-extrabold tracking-tight text-balance [font-stretch:85%] sm:text-[2rem]">
          {concept?.title ?? view.storeName}
        </h1>
        <p className="font-mono text-sm">
          {view.dateShort} · {view.timeText} · {view.venue ?? view.settingLabel}
        </p>
        <p className="text-sm text-ink-soft">{view.address}</p>
      </div>

      {tiles.length > 0 && concept && (
        <ul aria-label="What to do" className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <Tile key={t.key} tile={t} />
          ))}
        </ul>
      )}

      {view.offers.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Promos</p>
          <ul className="flex flex-wrap gap-2">
            {view.offers.map((offer) => (
              <li key={offer} className="rounded-md bg-sun-soft px-2.5 py-1 text-sm font-semibold text-pretty">
                “{offer}”
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-soft">
        <ProvenanceBadge kind={view.provenance} date={view.madeOn ?? undefined} />
        {view.fictional && <span>{view.fictional}</span>}
      </div>
    </header>
  );
}
