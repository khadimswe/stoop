import type { CityView, DemographicsView, DimensionView, SeedView, SkewBarView, TasteTagView } from "@/lib/report/view/why";
import { cn } from "cn";
import { OriginChip, ReceiptLink, SeedReceipt, StatusTag } from "./receipt-link";

export const CARD = "flex min-w-0 flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5";
export const CARD_TITLE = "font-display text-lg leading-snug font-bold [font-stretch:90%] sm:text-xl";

/** "Qloo measured from these seeds": every seed with its origin, each opening its receipt. */
export function SeedsCard({ seeds }: { seeds: SeedView[] }) {
  return (
    <article aria-labelledby="why-seeds" className={CARD}>
      <h3 id="why-seeds" className={CARD_TITLE}>
        Qloo measured from these seeds
      </h3>
      {seeds.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {seeds.map((seed) => (
            <li key={`${seed.kind}-${seed.name}`} className="max-w-full">
              <SeedReceipt origin={seed.origin} name={seed.name} kind={seed.kind} receipt={seed.receipt} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No seeds resolved in Qloo for this run.</p>
      )}
      <p className="text-xs text-ink-soft">Qloo: tags from your page. Suggested: proposed by Stoop and confirmed in Qloo. You: added by you.</p>
    </article>
  );
}

/** The Reality Check by dimension: what you said, what Qloo measured, and the outcome. A near tie is never a gap. */
export function DimensionsCard({ dimensions }: { dimensions: DimensionView[] }) {
  if (dimensions.length === 0) return null;
  return (
    <article aria-labelledby="why-dimensions" className={CARD}>
      <h3 id="why-dimensions" className={CARD_TITLE}>
        Reality Check, by dimension
      </h3>
      <dl className="flex flex-col">
        {dimensions.map((d) => (
          <div key={d.dimension} className="flex flex-col gap-1 border-t border-hairline py-2.5 first:border-t-0 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-sm font-semibold">{d.label}</dt>
              <StatusTag tone={d.outcome === "confirmed" ? "qloo" : d.outcome === "gap" || d.outcome === "near_tie" ? "interpreted" : "unknown"}>{d.outcomeLabel}</StatusTag>
            </div>
            <dd className="flex flex-col gap-0.5 text-sm">
              {d.stated && (
                <span>
                  <span className="text-ink-soft">{d.statedBy === "Read from your site" ? "Read from your site (not from Qloo): " : "You said: "}</span>
                  {d.stated}
                </span>
              )}
              <span>
                <span className="text-ink-soft">Qloo measured: </span>
                <ReceiptLink receipt={d.receipt}>{d.measured}</ReceiptLink>
              </span>
              {d.position && <span className="text-xs text-ink-soft">{d.position}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-hairline pt-3 text-xs text-ink-soft">What you said is compared with what Qloo measured, one dimension at a time. A near tie is never called a gap.</p>
    </article>
  );
}

/** One relative skew: a bar either side of zero (decorative) and the number, which opens the receipt. */
function SkewRow({ bar, receipt }: { bar: SkewBarView; receipt: DemographicsView["receipt"] }) {
  const half = `${bar.magnitude / 2}%`;
  return (
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
      <span>{bar.label}</span>
      <span aria-hidden="true" className="relative h-2.5 rounded-full bg-fill">
        <span className="absolute inset-y-0 left-1/2 w-px bg-concrete-line" />
        <span className={cn("absolute inset-y-0 rounded-full bg-dusk", bar.skew >= 0 ? "left-1/2" : "right-1/2")} style={{ width: half }} />
      </span>
      <ReceiptLink receipt={receipt} className="inline-flex min-h-11 items-center font-mono text-xs sm:min-h-0">
        {bar.text}
      </ReceiptLink>
    </li>
  );
}

function TagGroup({ title, tags: all }: { title: string; tags: TasteTagView[] }) {
  // No evidence, no display.
  const tags = all.filter((tag) => tag.receipt);
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li key={tag.id} className="max-w-full">
            <OriginChip origin="qloo" receipt={tag.receipt} label={tag.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const FLAG_WORDS: Readonly<Record<string, string>> = {
  "thin-heatmap": "Qloo's city map came back thin for these seeds, so the city ranking is a weak signal.",
  "few-seeds": "Few seeds resolved in Qloo, so this neighborhood rests on few signals.",
};

/** "Your taste neighborhood": skews (relative, never shares), taste tags, and cities by reference-corrected lift. */
export function NeighborhoodCard({
  demographics,
  tags,
  cities,
  smallSetOnly,
  swinging,
  flags,
}: {
  demographics: DemographicsView | null;
  tags: TasteTagView[];
  cities: CityView[];
  smallSetOnly: string[];
  swinging: string[];
  flags: string[];
}) {
  if (!demographics && tags.length === 0 && cities.length === 0) return null;
  return (
    <article aria-labelledby="why-neighborhood" className={CARD}>
      <div className="flex flex-col gap-1">
        <h3 id="why-neighborhood" className={CARD_TITLE}>
          Your taste neighborhood
        </h3>
        <p className="text-sm text-ink-soft">The audience around your product, as Qloo measured it from the seeds. Skews are relative to all audiences, from -1 to 1.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {demographics && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">Age skew</h4>
              <ul className="flex flex-col gap-2">
                {demographics.age.map((bar) => (
                  <SkewRow key={bar.key} bar={bar} receipt={demographics.receipt} />
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">Gender skew</h4>
              <ul className="flex flex-col gap-2">
                {demographics.gender.map((bar) => (
                  <SkewRow key={bar.key} bar={bar} receipt={demographics.receipt} />
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <TagGroup title="Music it leans into" tags={tags.filter((t) => t.kind === "music")} />
          <TagGroup title="Mood it leans into" tags={tags.filter((t) => t.kind === "tone")} />
          {cities.length > 0 && (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">Cities by lift</h4>
              <ol className="flex flex-col gap-1 text-sm">
                {cities.map((city) => (
                  <li key={city.label} className="flex items-center gap-2">
                    <span className="w-7 shrink-0 font-mono text-xs text-ink-soft">#{city.rank}</span>
                    <ReceiptLink receipt={city.receipt} className="inline-flex min-h-11 items-center sm:min-h-0">
                      {city.label}
                    </ReceiptLink>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-ink-soft">
                Ranked against {cities[0].comparedWith} reference audiences by reference-corrected lift. A city sets the scene, never the cast.
              </p>
            </div>
          )}
        </div>
      </div>
      {(smallSetOnly.length > 0 || swinging.length > 0 || flags.length > 0) && (
        <ul className="flex flex-col gap-1 border-t border-hairline pt-3 text-xs text-ink-soft">
          {swinging.length > 0 && <li>Left out because the rank swings between reference sets: {swinging.join(", ")}.</li>}
          {smallSetOnly.length > 0 && <li>Held only against the small set, so never used as a setting: {smallSetOnly.join(", ")}.</li>}
          {flags.map((flag) => (
            <li key={flag}>{FLAG_WORDS[flag] ?? flag}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
