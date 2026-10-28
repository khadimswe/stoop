import Image from "next/image";
import Link from "next/link";
import { TwoBlocks } from "@/components/stoop/landing/two-blocks";
import { Button } from "@/components/ui/button";
import { FOUNDER_STORY, HERO, PILOT_COPY, PILOT_LINE, PILOT_RESULT, PILOT_RESULT_LABEL } from "@/lib/marketing/pilot";
import { examplePlanPath, PLAN_EXAMPLES } from "@/lib/plan/example-list";
import { loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { blockSide } from "@/lib/plan/view/two-blocks";

// The landing: recorded example stores only, built at build time with zero API calls.
export const ensureStatic = "navigation";

const STEPS = [
  { n: "1", title: "Your store", line: "The store, the day, today's promos." },
  { n: "2", title: "Your block", line: "Qloo reads the city's music and the spots nearby." },
  { n: "3", title: "The plan", line: "Music, snacks, a prize wheel and a shopping list." },
  { n: "4", title: "Post it", line: "A poster and posts. You tap to share." },
] as const;

const ROLES = [
  { title: "Store manager", line: "This Saturday's table." },
  { title: "Multi-store manager", line: "One plan per store." },
  { title: "District manager", line: "Every store at a glance." },
] as const;

export default function Home() {
  const slugs = recordedPlanSlugs();
  const views = slugs.map((slug) => ({ slug, view: loadPlanExampleView(slug) }));
  // The hero compares two stores in two cities: the lead and the next recorded one.
  const lead = PLAN_EXAMPLES.find((e) => e.lead)?.slug;
  const pair = [views.find((v) => v.slug === lead) ?? views[0], views.find((v) => v.slug !== lead)].filter((v): v is NonNullable<typeof v> => Boolean(v));
  const sides = pair.length === 2 ? ([blockSide(pair[0]!.view, examplePlanPath(pair[0]!.slug)), blockSide(pair[1]!.view, examplePlanPath(pair[1]!.slug))] as const) : null;

  return (
    <main className="flex-1">
      <section aria-labelledby="hero-title" className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pt-10 pb-16 sm:pt-14">
        <div className="flex max-w-3xl flex-col gap-5">
          <h1 id="hero-title" className="font-display font-extrabold text-balance [font-stretch:75%]" style={{ fontSize: "clamp(3rem, 13vw, 6.5rem)", lineHeight: 0.9, letterSpacing: "-0.03em" }}>
            {HERO.headline}
          </h1>
          <p className="max-w-[34em] text-lg leading-relaxed text-pretty text-ink-soft">{HERO.sub}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Button asChild size="lg">
              <Link href="/start">Plan an event</Link>
            </Button>
            {PILOT_COPY && PILOT_LINE && <span className="text-sm text-ink-soft">{PILOT_LINE}</span>}
          </div>
        </div>
        {sides && <TwoBlocks sides={sides} />}
        {FOUNDER_STORY && (
          <figure className="flex max-w-3xl flex-col gap-3 border-l-[3px] border-ink pl-5">
            <blockquote className="flex flex-col gap-2">
              <p className="text-lg leading-relaxed text-pretty">“{FOUNDER_STORY.quote}”</p>
              <p className="font-display text-xl leading-snug font-extrabold text-pretty [font-stretch:85%]">{FOUNDER_STORY.line}</p>
            </blockquote>
            <figcaption className="text-sm text-ink-soft">{FOUNDER_STORY.credit}</figcaption>
          </figure>
        )}
        {PILOT_RESULT && (
          <p className="flex flex-col gap-0.5 text-sm">
            <span className="font-semibold">{PILOT_RESULT.line}</span>
            <span className="text-ink-soft">{PILOT_RESULT_LABEL}</span>
          </p>
        )}
      </section>

      <section id="examples" aria-labelledby="examples-title" className="scroll-mt-24 border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14">
          <h2 id="examples-title" className="type-h2">
            Example stores
          </h2>
          <ul className="grid gap-4 sm:grid-cols-3">
            {views.map(({ slug, view }) => (
              <li key={slug}>
                <Link href={examplePlanPath(slug)} className="group grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 sm:flex sm:flex-col sm:items-stretch">
                  {view.marketing.poster.src && (
                    <Image
                      src={view.marketing.poster.src}
                      alt={view.marketing.poster.alt}
                      width={540}
                      height={675}
                      unoptimized
                      className="row-span-2 aspect-[4/5] w-full rounded-xl border-2 border-ink bg-fill object-cover shadow-float transition-transform motion-safe:group-hover:-translate-y-0.5 sm:rounded-card"
                    />
                  )}
                  <span className="flex flex-col gap-1">
                    <span className="text-sm text-ink-soft">
                      {view.header.storeName}, {view.header.cityLine.split(",")[0]}
                    </span>
                    <span className="font-display text-lg leading-tight font-extrabold text-balance underline-offset-4 [font-stretch:85%] group-hover:underline">{view.concept?.title}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">Fictional stores. Not affiliated with or endorsed by T-Mobile.</p>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="scroll-mt-24 border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14">
          <h2 id="how-title" className="type-h2">
            How it works
          </h2>
          <ol className="grid gap-x-8 gap-y-5 border-t-2 border-ink pt-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-1">
                <span className="font-mono text-sm text-ink-soft">{s.n}</span>
                <h3 className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">{s.title}</h3>
                <p className="text-base text-pretty text-ink-soft">{s.line}</p>
              </li>
            ))}
          </ol>
          <p className="text-sm text-ink-soft">Every pick has a receipt. Nothing posts without you.</p>
        </div>
      </section>

      <section aria-labelledby="who-title" className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14">
          <h2 id="who-title" className="type-h2">
            For every manager
          </h2>
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {ROLES.map((r) => (
              <li key={r.title} className="flex flex-col gap-1">
                <h3 className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">{r.title}</h3>
                <p className="text-base text-ink-soft">{r.line}</p>
              </li>
            ))}
          </ul>
          <Link href="/stores" className="inline-flex min-h-11 items-center self-start text-sm font-bold underline decoration-2 underline-offset-4 hover:decoration-brick">
            See my stores
          </Link>
        </div>
      </section>
    </main>
  );
}
