import { Music, Store } from "lucide-react";
import type { LocalView } from "@/lib/plan/view/plan";
import { Card, EmptyNote, PlanSection } from "./plan-section";
import { RefChip } from "./rich-text";

/**
 * What Qloo measured for this store: the music its city plays (local artists and the styles they
 * share, by city name) and the block (places near the store, with Qloo's own "why" and the distance).
 * Neighborhood taste is not claimed: the city sets the music, the block sets the food and partners.
 */
export function LocalSection({ view, pending }: { view: LocalView; pending?: boolean }) {
  const { city, block, gaps } = view;
  return (
    <PlanSection
      id="local"
      kicker="What Qloo measured"
      title="Your city and your block"
      description="Aggregate taste data for the city, and the places around the store. No individual shopper data, ever."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 font-display text-lg leading-tight font-bold [font-stretch:90%]">
            <Music aria-hidden="true" className="size-5" />
            {city ? `What ${city.name} plays` : "City music"}
          </h3>
          {!city ? (
            <EmptyNote>{pending ? "Asking Qloo what this city listens to..." : "No Qloo signal for this city's music."}</EmptyNote>
          ) : (
            <>
              <p className="text-sm text-ink-soft">Artists Qloo ranks for {city.name}, adults {city.ageText}, by city name. The city sets the music; Qloo has no reliable read on a single neighborhood.</p>
              <ol aria-label={`Artists ${city.name} plays`} className="flex flex-col">
                {city.artists.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 border-b border-hairline py-2 last:border-b-0">
                    <span className="w-7 shrink-0 pt-1 font-mono text-xs text-ink-soft">#{a.rank}</span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span>
                        <RefChip name={a.name} receiptKey={a.receipt} className="mx-0" />
                      </span>
                      {a.genres.length > 0 && <span className="text-xs text-ink-soft">{a.genres.join(", ")}</span>}
                    </div>
                  </li>
                ))}
              </ol>
              {city.styles.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold">Music styles</p>
                  <ul className="flex flex-wrap gap-2">
                    {city.styles.map((s) => (
                      <li key={s.name}>
                        <RefChip name={s.name} receiptKey={s.receipt} className="mx-0" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2 font-display text-lg leading-tight font-bold [font-stretch:90%]">
            <Store aria-hidden="true" className="size-5" />
            The block
          </h3>
          {!block ? (
            <EmptyNote>{pending ? "Finding food spots, venues and parks near the store..." : "No Qloo signal for places near this store."}</EmptyNote>
          ) : block.places.length === 0 ? (
            <EmptyNote>No Qloo places within {block.radiusText} of the store.</EmptyNote>
          ) : (
            <>
              <p className="text-sm text-ink-soft">Places Qloo returned within {block.radiusText} of the store. They double as partners: food to buy, a venue to send people to.</p>
              <ul aria-label="Places near the store" className="flex flex-col">
                {block.places.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1.5 border-b border-hairline py-3 first:pt-0 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <RefChip name={p.name} receiptKey={p.receipt} className="mx-0" />
                      <span className="text-xs font-semibold text-ink-soft">{p.kindLabel}</span>
                      {p.distanceText && <span className="font-mono text-xs text-ink-soft">{p.distanceText}</span>}
                    </div>
                    {p.why && (
                      <p className="text-sm text-pretty">
                        <span className="font-semibold">Qloo&apos;s why: </span>
                        {p.why}
                      </p>
                    )}
                    {p.tags.length > 0 && <p className="text-xs text-ink-soft">{p.tags.slice(0, 6).join(" · ")}</p>}
                    {p.address && <p className="text-xs text-ink-soft">{p.address}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
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
