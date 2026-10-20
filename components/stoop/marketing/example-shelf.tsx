import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Screen } from "@/components/stoop/screen";
import type { ShelfItemView } from "@/lib/marketing/landing";
import { cn } from "cn";
import { reveal, REVEAL_CLASS } from "./reveal";
import { SectionIntro } from "./section-intro";
import { SourceTag } from "./source-tag";

/**
 * The three examples as screens, each showing its own Reality Check: what the brand said, what Qloo
 * measured (and a near tie when there is one) and what the generic AI brief assumed, verbatim from
 * the recorded run. Phones get a sideways shelf inside a labeled region; wider screens a row of three.
 */
export function ExampleShelf({ items }: { items: ShelfItemView[] }) {
  return (
    <section id="examples" aria-labelledby="examples-title" className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-8 px-5 pt-6 pb-16">
      <div {...reveal()} className={REVEAL_CLASS}>
        <SectionIntro
          id="examples-title"
          kicker="Examples"
          title="Three brands. Three taste neighborhoods."
          lead="Each one is a recorded run on real Qloo responses, saved so it loads instantly. Open one to see every receipt."
        />
      </div>
      <div
        role="region"
        aria-label="Example reports"
        tabIndex={0}
        {...reveal(120)}
        className={cn("relative -mx-5 overflow-x-auto px-5 pb-4 md:mx-0 md:overflow-visible md:px-0 md:pb-0", REVEAL_CLASS)}
      >
        <ul className="flex snap-x snap-mandatory gap-5 md:grid md:grid-cols-3">
          {items.map((item) => (
            <li key={item.slug} className="flex w-[82vw] max-w-[22rem] shrink-0 snap-start md:w-auto md:max-w-none">
              {/* One link per card, stretched over it, so the Reality Check stays readable text. */}
              <article className="group relative flex w-full flex-col gap-4">
                <Screen className="flex flex-1 flex-col gap-4 p-5 transition-transform duration-200 ease-smooth group-hover:-translate-y-1">
                  <p className="font-mono text-[0.6875rem] tracking-widest text-paper-dim uppercase">Reality Check · recorded</p>
                  {item.said && (
                    <div className="flex flex-col items-start gap-1.5">
                      <p className="text-sm leading-snug text-paper">{item.said}</p>
                      <SourceTag source="brand" surface="screen" />
                    </div>
                  )}
                  {item.measured && (
                    <div className="flex flex-col items-start gap-1.5">
                      <p className="font-display text-lg leading-snug font-bold [font-stretch:90%]">{item.measured}</p>
                      <SourceTag source="qloo" surface="screen" />
                      {item.receiptLine && <p className="font-mono text-[0.6875rem] leading-snug break-words text-paper-dim">{item.receiptLine}</p>}
                    </div>
                  )}
                  {item.near && (
                    <div className="flex flex-col items-start gap-1.5">
                      <p className="text-sm leading-snug text-paper-dim">{item.near}</p>
                      <SourceTag source="qloo" surface="screen" />
                      {item.nearReceiptLine && <p className="font-mono text-[0.6875rem] leading-snug break-words text-paper-dim">{item.nearReceiptLine}</p>}
                    </div>
                  )}
                  {item.worlds.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="font-mono text-[0.6875rem] tracking-widest text-paper-dim uppercase">
                        {item.worlds.length} concept {item.worlds.length === 1 ? "world" : "worlds"}
                      </p>
                      <ul className="flex flex-wrap gap-1.5">
                        {item.worlds.map((w) => (
                          <li key={w.segmentId} className="rounded-full border-[1.5px] border-paper/40 px-2.5 py-1 text-xs leading-tight font-semibold text-paper">
                            {w.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.generic && (
                    <div className="mt-auto flex flex-col items-start gap-1.5 border-t border-paper/15 pt-4">
                      <p className="text-sm leading-snug text-concrete-screen">{item.generic}</p>
                      <SourceTag source="generic" surface="screen" />
                    </div>
                  )}
                </Screen>
                <div className="flex flex-col gap-1 px-1">
                  <h3 className="type-h3">
                    <Link
                      href={item.href}
                      className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-4 focus-visible:after:outline-dusk"
                    >
                      {item.brand}
                    </Link>
                  </h3>
                  <p className="text-sm text-ink-soft first-letter:uppercase">{item.product}</p>
                  <span aria-hidden="true" className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-ink underline decoration-2 underline-offset-4 group-hover:decoration-brick">
                    Open example
                    <ArrowRight className="size-4" />
                  </span>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>
      <p className="-mt-4 text-sm text-ink-soft md:hidden">Swipe for more examples.</p>
    </section>
  );
}
