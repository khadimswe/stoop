import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "@/components/stoop/floor/glyphs";
import { NumBadge, PRIMARY_INLINE } from "@/components/stoop/floor/kit";
import { HeroMedia } from "@/components/stoop/home/hero-media";
import { HomeNav } from "@/components/stoop/home/home-nav";
import { FOUNDER_STORY, HERO, PILOT_COPY, PILOT_LINE, PILOT_MEDIA, PILOT_RESULT, PILOT_RESULT_LABEL } from "@/lib/marketing/pilot";
import { LEAD_PLAN_EXAMPLE, PLAN_EXAMPLES } from "@/lib/plan/example-list";
import { eventStats, landingCompare, playView, placeMeta } from "@/lib/plan/view/floor";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { loadPlanExampleReport, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { stampDate } from "@/lib/plan/view/format";

// The landing: recorded example stores only, built at build time with zero API calls.
export const ensureStatic = "navigation";

const WHO = [
  { title: "Store manager", line: "This Saturday's table, poster and posts." },
  { title: "Multi-store manager", line: "One plan per store, each for its own block." },
  { title: "District manager", line: "Every store's next event on one list." },
] as const;

/** A small, still app screen for "How it works": real data from the lead example, at a reduced scale. */
function MiniScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div aria-hidden="true" className="w-[270px] shrink-0 overflow-hidden rounded-[20px] bg-fl-page p-4 text-fl-ink">
      <p className="text-center text-xs font-semibold">{title}</p>
      <div className="mt-3 flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

export default function Home() {
  const slugs = recordedPlanSlugs();
  const lead = (slugs.find((s) => s === LEAD_PLAN_EXAMPLE.slug) ?? slugs[0])!;
  const view = loadPlanExampleView(lead);
  const report = loadPlanExampleReport(lead);
  const compare = landingCompare(view);
  const play = playView(view);
  const examples = slugs.map((slug) => ({ slug, view: loadPlanExampleView(slug), city: PLAN_EXAMPLES.find((e) => e.slug === slug)?.city ?? "" }));

  return (
    <>
      <HomeNav heroId="hero" />
      <main className="flex-1">
        <section id="hero" aria-labelledby="hero-title" className="mx-auto grid max-w-[1248px] items-center gap-10 px-4 pt-8 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_540px] lg:pt-16 lg:pb-24">
          <div className="flex max-w-xl flex-col gap-6">
            <p className="text-sm font-medium text-fl-dim">{HERO.eyebrow}</p>
            <h1 id="hero-title" className="font-serif text-[2.875rem] leading-[1.02] font-normal tracking-[-0.02em] text-balance lg:text-[5rem] lg:leading-none">
              {HERO.headline}
            </h1>
            <p className="text-lg leading-[1.5] text-pretty text-fl-muted lg:text-xl">{HERO.sub}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/start" className={PRIMARY_INLINE}>
                Plan an event
              </Link>
              <Link href={exampleHrefs(lead).event} className="inline-flex min-h-11 items-center gap-1.5 text-base font-medium underline decoration-1 underline-offset-4 hover:decoration-2">
                See an example
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
            <p className="max-w-md text-sm text-fl-dim">{HERO.note}</p>
            {PILOT_COPY && PILOT_LINE && <p className="text-sm text-fl-muted">{PILOT_LINE}</p>}
            {PILOT_RESULT && (
              <p className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold">{PILOT_RESULT.line}</span>
                <span className="text-fl-dim">{PILOT_RESULT_LABEL}</span>
              </p>
            )}
          </div>
          <HeroMedia media={PILOT_MEDIA} poster={view.marketing.poster.medium ? { src: view.marketing.poster.medium, alt: view.marketing.poster.alt } : null} caption={`${view.concept?.title ?? view.header.storeName} · example poster`} aside="Fictional store" />
        </section>

        <section id="how" aria-labelledby="how-title" className="floor-dark scroll-mt-20 bg-fl-dark text-fl-dark-bright">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-10 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-fl-dark-dim">How it works</p>
              <h2 id="how-title" className="font-serif text-[2.125rem] leading-[1.06] font-normal text-balance lg:text-[3.375rem]">
                Planned for the block you&apos;re on.
              </h2>
            </div>
            <ol className="-mx-4 flex gap-6 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
              <li className="flex shrink-0 flex-col gap-4">
                <MiniScreen title={view.header.storeName}>
                  <p className="font-serif text-xl">Your block</p>
                  <ul className="overflow-hidden rounded-[14px] bg-white text-xs [&>li+li]:border-t [&>li+li]:border-fl-rule">
                    {(view.local.block?.places ?? []).slice(0, 4).map((p) => (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                        <NumBadge n={p.n} on={Boolean(view.placeUses[p.id])} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{p.name}</span>
                          <span className="block text-fl-dim">{placeMeta(p)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </MiniScreen>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-fl-signal">1 · Your block</p>
                  <h3 className="text-lg font-semibold">Qloo maps your block</h3>
                  <p className="max-w-xs text-sm text-fl-dark-dim">Spots within 1.5 km of the door, and what your city plays.</p>
                </div>
              </li>
              <li className="flex shrink-0 flex-col gap-4">
                <MiniScreen title="The event">
                  <p className="text-[0.6875rem] text-fl-dim">
                    {view.header.dateShort} · {view.header.timeText}
                  </p>
                  <p className="font-serif text-xl leading-tight">{view.concept?.title}</p>
                  <div className="grid grid-cols-3 overflow-hidden rounded-[14px] bg-white text-xs">
                    {eventStats(view).map((s, i) => (
                      <div key={i} className={i > 0 ? "border-l border-fl-rule px-2 py-2" : "px-2 py-2"}>
                        <p className="text-base font-medium tabular-nums">{s.value}</p>
                        <p className="text-fl-dim">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="overflow-hidden rounded-[14px] bg-white text-xs [&>li+li]:border-t [&>li+li]:border-fl-rule">
                    {play.artists.slice(0, 3).map((a, i) => (
                      <li key={a} className="flex items-center gap-2 px-3 py-2">
                        <NumBadge n={i + 1} />
                        {a}
                      </li>
                    ))}
                  </ul>
                </MiniScreen>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-fl-signal">2 · The event</p>
                  <h3 className="text-lg font-semibold">Stoop plans the table</h3>
                  <p className="max-w-xs text-sm text-fl-dark-dim">What to play, what to serve, the wheel and the timeline, on {view.header.budgetText.replace(" budget", "")}.</p>
                </div>
              </li>
              <li className="flex shrink-0 flex-col gap-4">
                <MiniScreen title="Promote">
                  <p className="font-serif text-xl">Promote</p>
                  <p className="text-[0.6875rem] text-fl-dim">Nothing posts until you approve.</p>
                  <ul className="overflow-hidden rounded-[14px] bg-white text-xs [&>li+li]:border-t [&>li+li]:border-fl-rule">
                    {[
                      { g: <FacebookGlyph className="size-3.5" />, t: "Facebook Page" },
                      { g: <InstagramGlyph className="size-3.5" />, t: "Instagram" },
                      { g: <WhatsAppGlyph className="size-3.5" />, t: "WhatsApp" },
                    ].map((a) => (
                      <li key={a.t} className="flex items-center gap-2 px-3 py-2.5">
                        <span className="flex size-6 items-center justify-center rounded-[7px] bg-fl-ink text-white">{a.g}</span>
                        {a.t}
                      </li>
                    ))}
                  </ul>
                </MiniScreen>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold text-fl-signal">3 · Promote</p>
                  <h3 className="text-lg font-semibold">The poster goes out</h3>
                  <p className="max-w-xs text-sm text-fl-dark-dim">Facebook, Instagram and WhatsApp. You approve every post.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {FOUNDER_STORY && (
          <section aria-label="Why Stoop exists" className="mx-auto max-w-[1248px] px-4 py-16 sm:px-8 lg:py-24">
            <figure className="flex max-w-4xl flex-col gap-5">
              <blockquote className="flex flex-col gap-4">
                <p className="font-serif text-[1.8125rem] leading-[1.18] text-pretty lg:text-[2.75rem]">&ldquo;{FOUNDER_STORY.quote}&rdquo;</p>
                <p className="text-lg font-semibold text-pretty">{FOUNDER_STORY.line}</p>
              </blockquote>
              <figcaption className="text-sm text-fl-dim">{FOUNDER_STORY.credit}</figcaption>
            </figure>
          </section>
        )}

        {compare.length > 0 && (
          <section aria-labelledby="generic-title" className="bg-fl-band">
            <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium text-fl-dim">Same table, different block</p>
                <h2 id="generic-title" className="font-serif text-[2.125rem] leading-[1.06] font-normal text-balance lg:text-[3.375rem]">
                  A generic AI plan could be for any store.
                </h2>
              </div>
              <table className="w-full text-sm">
                <caption className="sr-only">The generic AI plan and Stoop&apos;s plan for {view.header.storeName}, line by line</caption>
                <thead className="max-md:sr-only">
                  <tr className="border-b border-fl-ink text-left text-[0.8125rem] text-fl-dim">
                    <th scope="col" className="w-28 py-2 font-medium">
                      <span className="sr-only">Line</span>
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Generic AI plan
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Stoop, {view.header.storeName}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map((r) => (
                    <tr key={r.row} className="border-b border-fl-rule max-md:grid max-md:grid-cols-[4.5rem_minmax(0,1fr)] max-md:gap-x-3 max-md:py-3">
                      <th scope="row" className="py-3 text-left font-semibold max-md:row-span-2 max-md:py-0">
                        {r.row}
                      </th>
                      <td className="py-3 text-fl-dim max-md:py-0">
                        <span className="sr-only md:hidden">Generic: </span>
                        {r.generic}
                      </td>
                      <td className="py-3 max-md:py-0 max-md:pt-1 max-md:font-medium">
                        <span className="sr-only md:hidden">Stoop: </span>
                        {r.stoop}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[0.8125rem] text-fl-dim">
                {view.header.cityLine.split(",")[0]} example, recorded {stampDate(report.meta.createdAt)}. {view.generic?.check?.line ?? ""}{" "}
                <Link href={`${exampleHrefs(lead).event}#compare`} className="underline underline-offset-[3px]">
                  See the whole comparison
                </Link>
              </p>
            </div>
          </section>
        )}

        <section id="examples" aria-labelledby="examples-title" className="scroll-mt-20">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-fl-dim">Examples</p>
              <h2 id="examples-title" className="font-serif text-[2.125rem] leading-[1.06] font-normal lg:text-[3.375rem]">
                Three stores, three blocks.
              </h2>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-3 lg:gap-x-8">
              {examples.map(({ slug, view: v, city }) => (
                <li key={slug}>
                  <Link href={exampleHrefs(slug).event} className="group flex flex-col gap-3">
                    {v.marketing.poster.thumb && (
                      <Image src={v.marketing.poster.thumb} alt={v.marketing.poster.alt} width={360} height={450} unoptimized className="aspect-[4/5] h-auto w-full rounded-[8px] bg-fl-dark" />
                    )}
                    <span className="flex flex-col gap-1">
                      <span className="text-[0.8125rem] text-fl-dim">
                        {v.header.storeName} · {city}
                      </span>
                      <span className="font-serif text-lg leading-snug text-balance group-hover:underline lg:text-xl">{v.concept?.title}</span>
                      <span className="text-[0.8125rem] text-fl-dim tabular-nums">
                        {v.header.dateShort} · {v.header.timeText}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-[0.8125rem] text-fl-dim">Fictional stores. Not affiliated with or endorsed by T-Mobile.</p>
          </div>
        </section>

        <section aria-labelledby="who-title" className="border-t border-fl-rule">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-fl-dim">Who it&apos;s for</p>
              <h2 id="who-title" className="font-serif text-[2.125rem] leading-[1.06] font-normal text-balance lg:text-[3.375rem]">
                The store, and the stores above it.
              </h2>
            </div>
            <ul className="grid gap-6 border-t border-fl-ink pt-6 md:grid-cols-3">
              {WHO.map((w) => (
                <li key={w.title} className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">{w.title}</h3>
                  <p className="text-[0.9375rem] text-fl-muted">{w.line}</p>
                </li>
              ))}
            </ul>
            <Link href="/stores" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium underline underline-offset-4">
              See My stores
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="floor-dark bg-fl-dark text-fl-dark-bright">
          <div className="mx-auto flex max-w-[1248px] flex-col items-start justify-between gap-6 px-4 py-14 sm:flex-row sm:items-center sm:px-8">
            <h2 id="cta-title" className="font-serif text-[2.125rem] leading-[1.06] font-normal lg:text-[3.375rem]">
              Plan this Saturday&apos;s table.
            </h2>
            <Link href="/start" className="inline-flex h-13 items-center rounded-[12px] bg-fl-dark-bright px-6 text-base font-semibold text-fl-ink hover:bg-white">
              Plan an event
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
