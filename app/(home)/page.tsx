import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { FloorReceipts } from "@/components/stoop/floor/receipts";
import { BeforeAfter } from "@/components/stoop/home/before-after";
import { HomeNav } from "@/components/stoop/home/home-nav";
import { DemoVideoSlot, MediaBand } from "@/components/stoop/home/media-band";
import { ReceiptLink } from "@/components/stoop/home/receipt-link";
import { ReserveStores } from "@/components/stoop/home/reserve-stores";
import { StorePanel } from "@/components/stoop/home/store-panel";
import { StoreTabs } from "@/components/stoop/home/store-tabs";
import { metaPostingEnabled } from "@/lib/config";
import { pickReceipts, postTimeline, storeShowcase, tablePicks, type TimelinePost } from "@/lib/marketing/landing-stores";
import { BEFORE_AFTER, DEMO_VIDEO, FOUNDER_STORY, HERO, PILOT_CARD, PILOT_COPY, PILOT_LINE, PILOT_MEDIA, PILOT_RESULT, PILOT_RESULT_LABEL, POSTING_COPY, WHO } from "@/lib/marketing/pilot";
import { LEAD_PLAN_EXAMPLE, PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES } from "@/lib/plan/example-list";
import { landingCompare } from "@/lib/plan/view/floor";
import { stampDate } from "@/lib/plan/view/format";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { loadPlanExampleReport, loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";
import { cn } from "cn";

// The landing: recorded example stores only, built at build time with zero API calls.
export const ensureStatic = "navigation";

const EYEBROW = "text-sm font-semibold tracking-[0.02em] text-fl-dim";
const H2 = "font-serif text-[clamp(1.875rem,1.3rem+2.5vw,3.375rem)] leading-[1.06] font-normal tracking-[-0.01em] text-balance";
const LEDE = "max-w-[46rem] text-lg leading-[1.5] text-pretty text-fl-muted lg:text-[1.1875rem]";

const STEPS = [
  { name: "Community", line: "Qloo maps the places within about a mile of your door and the artists your city plays.", href: "block" },
  { name: "Create", line: "Pick the day, the hours and the budget, and type your deals the way you'd say them.", href: "create" },
  { name: "Event", line: "Stoop plans the table: music, snacks, a prize wheel and the timeline, fit to the budget.", href: "event" },
  { name: "Poster", line: "A poster with your deals word for word, ready to print or share.", href: "poster" },
  { name: "Promote", line: "Posts written for Facebook, Instagram and WhatsApp. Nothing goes out without you.", href: "promote" },
] as const;

const CHIP: Record<"ok" | "lime" | "plain", string> = {
  ok: "bg-fl-ok-bg text-fl-ok",
  lime: "bg-fl-signal text-fl-ink",
  plain: "bg-fl-band text-fl-muted",
};
const chipTone = (p: TimelinePost) => (p.status === "now" || p.statusText === "Ready to share" ? "ok" : p.status === "scheduled" ? "lime" : "plain");

export default function Home() {
  const slugs = recordedPlanSlugs();
  const lead = (slugs.find((s) => s === LEAD_PLAN_EXAMPLE.slug) ?? slugs[0])!;
  const stores = slugs.map((slug) => {
    const view = loadPlanExampleView(slug);
    const report = loadPlanExampleReport(slug);
    const city = PLAN_EXAMPLES.find((e) => e.slug === slug)?.city ?? view.header.cityLine;
    const show = storeShowcase(view, report, slug, city);
    const keys = show.verdict.flatMap((p) => (p.kind === "pick" ? [p.receipt] : []));
    return { slug, view, report, show, receipts: pickReceipts(view.receipts, keys) };
  });
  const leadStore = stores.find((s) => s.slug === lead)!;
  const leadView = leadStore.view;
  const leadHrefs = exampleHrefs(lead);
  const picks = tablePicks(leadView, lead);
  const compare = landingCompare(leadView);
  const compareReceipts = pickReceipts(leadView.receipts, compare.flatMap((r) => [r.genericReceipt, r.stoopReceipt]));
  const posting = metaPostingEnabled();
  const postCopy = POSTING_COPY[posting ? "on" : "off"];
  const posts = postTimeline(PLAN_EXAMPLE_INPUTS[lead], posting);
  const cityName = leadView.local.city?.name ?? leadStore.show.city;

  return (
    <>
      <HomeNav />
      <main className="flex-1">
        {/* The hero fills the first screen (the band below only peeks in), so the H1 stays the largest paint. */}
        <section id="hero" aria-labelledby="hero-title" className="mx-auto flex min-h-[calc(100svh-72px-40px)] max-w-[1248px] flex-col items-center justify-center px-4 pt-10 pb-12 text-center sm:px-8">
          <p className="inline-flex min-h-8 items-center rounded-full border border-fl-line bg-white px-3.5 py-1 text-[0.8125rem] font-medium text-balance">{HERO.eyebrow}</p>
          {/* Fluid size with a floor and a ceiling, so no word ever runs wider than the column (320 px and up). */}
          <h1 id="hero-title" className="mt-6 max-w-[11em] font-serif text-[clamp(2.5rem,1.1rem+5.6vw,6rem)] leading-[1] font-normal tracking-[-0.02em] text-balance">
            {HERO.headline}
          </h1>
          <p className="mt-6 hidden max-w-[52rem] text-lg leading-[1.5] text-pretty text-fl-muted sm:block lg:text-[1.3125rem]">{HERO.sub}</p>
          <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-pretty text-fl-muted sm:hidden">{HERO.subShort}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Link href="/start" className="inline-flex h-12 items-center justify-center rounded-[12px] bg-fl-ink px-6 text-base font-semibold text-white hover:bg-[#2a2a2e]">
              Plan an event
            </Link>
            <Link href={leadHrefs.event} className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
              See a real plan
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="mt-7 flex flex-col items-center gap-x-7 gap-y-2 text-sm text-fl-dim sm:flex-row sm:flex-wrap sm:justify-center">
            {HERO.trust.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <i aria-hidden="true" className="block size-2 rounded-[2px] bg-fl-ink" />
                {t}
              </li>
            ))}
          </ul>
          {PILOT_COPY && PILOT_LINE && <p className="mt-4 text-sm text-fl-muted">{PILOT_LINE}</p>}
        </section>

        <MediaBand
          media={PILOT_MEDIA}
          still={{
            title: leadStore.show.title,
            line: `${leadView.header.storeName} · ${leadStore.show.city} · ${leadView.header.dateShort}, ${leadView.header.timeText}`,
            poster: leadStore.show.poster,
            picks,
            href: leadHrefs.event,
            fictional: leadView.header.fictional,
            receipts: pickReceipts(leadView.receipts, picks.map((p) => p.receipt)),
          }}
        />

        <BeforeAfter config={BEFORE_AFTER} />

        <section id="examples" aria-labelledby="examples-title" className="mt-16 scroll-mt-20 bg-fl-band lg:mt-24">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className={EYEBROW}>See it work</p>
              <h2 id="examples-title" className={H2}>
                Same table. Different community.
              </h2>
              <p className={LEDE}>Three example stores with the same kind of deals. Qloo picked different music, food spots and prizes for each one. Tap an underlined name to see why.</p>
            </div>
            <StoreTabs
              label="Example stores"
              tabs={stores.map((s) => ({ slug: s.slug, storeName: s.show.storeName, city: s.show.city, title: s.show.title }))}
              panels={stores.map((s) => (
                <StorePanel key={s.slug} show={s.show} receipts={s.receipts} />
              ))}
            />
          </div>
        </section>

        {compare.length > 0 && (
          <section id="generic" aria-labelledby="generic-title" className="mx-auto max-w-[1248px] px-4 py-16 sm:px-8 lg:py-24">
            <FloorReceipts receipts={compareReceipts}>
              <div className="flex flex-col gap-3">
                <p className={EYEBROW}>Why Qloo</p>
                <h2 id="generic-title" className={H2}>
                  A generic AI plan could be for any store.
                </h2>
                <p className={LEDE}>
                  We asked the same model for a plan for {leadView.header.storeName}, with the same budget and deals but no Qloo. Then Qloo checked what it picked.
                </p>
              </div>
              <table className="mt-8 w-full text-[0.9375rem] leading-[1.45]">
                <caption className="sr-only">The generic AI plan and Stoop&apos;s plan for {leadView.header.storeName}, line by line</caption>
                <thead className="max-md:sr-only">
                  <tr className="text-left text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">
                    <th scope="col" className="w-36 pb-3 font-semibold">
                      <span className="sr-only">Line</span>
                    </th>
                    <th scope="col" className="pr-8 pb-3 font-semibold">
                      Generic AI plan, no Qloo
                    </th>
                    <th scope="col" className="pb-3 font-semibold">
                      Stoop, {leadView.header.storeName}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map((r) => (
                    <tr key={r.row} className="border-t border-fl-rule max-md:flex max-md:flex-col max-md:gap-2 max-md:py-4">
                      <th scope="row" className="py-4 pr-4 text-left align-top font-semibold max-md:p-0">
                        {r.row}
                      </th>
                      <td className="py-4 pr-8 align-top text-fl-muted max-md:p-0">
                        <span className="mb-0.5 block text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase md:hidden">Generic AI plan</span>
                        {r.generic}
                        {r.genericReceipt && (
                          <>
                            {" "}
                            <ReceiptLink receiptKey={r.genericReceipt} href={`${leadHrefs.event}#compare`} className="text-sm font-medium whitespace-nowrap text-fl-ink underline underline-offset-[3px]" label={`Qloo's check of the generic plan's ${r.row.toLowerCase()}`}>
                              Qloo&apos;s check
                            </ReceiptLink>
                          </>
                        )}
                      </td>
                      <td className="py-4 align-top max-md:p-0">
                        <span className="mb-0.5 block text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase md:hidden">Stoop</span>
                        <span className="font-medium">{r.stoop}</span>
                        {r.stoopReceipt && (
                          <>
                            {" "}
                            <ReceiptLink receiptKey={r.stoopReceipt} href={leadHrefs.event} className="text-sm font-medium whitespace-nowrap text-fl-ink underline underline-offset-[3px]" label={`Why Qloo picked this: ${r.row.toLowerCase()}`}>
                              Receipt
                            </ReceiptLink>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-[0.8125rem] text-fl-dim">
                {cityName} example, recorded {stampDate(leadStore.report.meta.createdAt)}. Both plans had the same inputs; only Qloo was left out.{" "}
                <Link href={`${leadHrefs.event}#compare`} className="font-medium text-fl-ink underline underline-offset-[3px]">
                  See the whole comparison
                </Link>
              </p>
            </FloorReceipts>
          </section>
        )}

        <section id="how" aria-labelledby="how-title" className="scroll-mt-20 border-t border-fl-rule">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-10 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className={EYEBROW}>How it works</p>
              <h2 id="how-title" className={H2}>
                Five steps, about a minute of typing.
              </h2>
            </div>
            <ol className="grid border-t border-fl-ink sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((s, i) => (
                <li key={s.name} className={cn("flex flex-col gap-2 border-b border-fl-rule py-5 sm:pr-6 lg:border-b-0 lg:py-6", i > 0 && "lg:border-l lg:border-fl-rule lg:pl-6")}>
                  <p className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                    <span className="flex size-6 items-center justify-center rounded-full bg-fl-ink text-xs text-white">{i + 1}</span>
                    {s.name}
                  </p>
                  <p className="text-[0.9375rem] leading-[1.45] text-pretty text-fl-muted">{s.line}</p>
                  <Link href={leadHrefs[s.href]} className="mt-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium underline underline-offset-[3px]">
                    See it in the example
                    <span className="sr-only">: {s.name}</span>
                  </Link>
                </li>
              ))}
            </ol>
            <DemoVideoSlot video={DEMO_VIDEO} />
          </div>
        </section>

        <section aria-labelledby="posts-title" className="floor-dark bg-fl-dark text-fl-dark-bright">
          <div className="mx-auto grid max-w-[1248px] items-center gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-16 lg:py-24">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold tracking-[0.02em] text-fl-dark-dim">Promote</p>
              <h2 id="posts-title" className={H2}>
                {postCopy.title}
              </h2>
              <p className="text-lg leading-[1.5] text-pretty text-fl-dark-dim">{postCopy.body}</p>
              <p className="text-sm text-fl-dark-dim">{postCopy.note}</p>
            </div>
            <figure className="flex flex-col gap-3">
              <ol className="rounded-[20px] bg-fl-dark-2 px-4 py-1 sm:px-5">
                {posts.map((p, i) => (
                  <li key={p.title} className={cn("flex items-center gap-3 py-3.5", i > 0 && "border-t border-fl-dark-rule")}>
                    <span className="w-[4.75rem] shrink-0 text-sm font-semibold tabular-nums sm:w-24">{p.when}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-semibold">{p.title}</span>
                      <span className="block text-[0.8125rem] text-fl-dark-dim">{p.channels}</span>
                    </span>
                    <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", CHIP[chipTone(p)])}>{p.statusText}</span>
                  </li>
                ))}
              </ol>
              <figcaption className="text-[0.8125rem] text-fl-dark-dim">
                Example: {leadView.header.storeName}, {leadView.header.dateShort}, {leadView.header.timeText}.
              </figcaption>
            </figure>
          </div>
        </section>

        <section aria-label="Who built it and who it's for" className="mx-auto grid max-w-[1248px] gap-14 px-4 py-16 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-24">
          {FOUNDER_STORY && (
            <figure className="flex flex-col gap-4">
              <p className={EYEBROW}>Built on the sales floor</p>
              <blockquote className="flex flex-col gap-4">
                <p className="font-serif text-[1.8125rem] leading-[1.2] text-pretty lg:text-[2.25rem] lg:leading-[1.22]">&ldquo;{FOUNDER_STORY.quote}&rdquo;</p>
                <p className="text-base font-semibold text-pretty">{FOUNDER_STORY.line}</p>
              </blockquote>
              <figcaption className="text-sm text-fl-dim">{FOUNDER_STORY.credit}</figcaption>
            </figure>
          )}
          <div className="flex flex-col gap-4">
            <h2 className={EYEBROW}>Who it&apos;s for</h2>
            <ul className="[&>li+li]:border-t [&>li+li]:border-fl-rule">
              {WHO.map((w) => (
                <li key={w.title} className="flex flex-col gap-0.5 py-4">
                  <h3 className="text-[1.0625rem] font-semibold">{w.title}</h3>
                  <p className="text-[0.9375rem] text-pretty text-fl-muted">{w.line}</p>
                </li>
              ))}
            </ul>
            <ReserveStores title={PILOT_CARD.title} line={PILOT_CARD.line} />
            {PILOT_RESULT && (
              <p className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold">{PILOT_RESULT.line}</span>
                <span className="text-fl-dim">{PILOT_RESULT_LABEL}</span>
              </p>
            )}
            <Link href="/stores" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium underline underline-offset-4">
              See My stores
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="floor-dark bg-fl-ink text-fl-dark-bright">
          <div className="mx-auto flex max-w-[1248px] flex-col items-start justify-between gap-6 px-4 py-14 sm:flex-row sm:items-center sm:px-8">
            <h2 id="cta-title" className={H2}>
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
