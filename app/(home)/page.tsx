import { ArrowRight, Check, Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FloorReceipts } from "@/components/stoop/floor/receipts";
import { BeforeAfter } from "@/components/stoop/home/before-after";
import { HomeNav } from "@/components/stoop/home/home-nav";
import { DemoVideoSlot, HeroVideo } from "@/components/stoop/home/media-band";
import { ReceiptLink } from "@/components/stoop/home/receipt-link";
import { ReserveStores } from "@/components/stoop/home/reserve-stores";
import { StorePanel } from "@/components/stoop/home/store-panel";
import { StoreTabs } from "@/components/stoop/home/store-tabs";
import { RealTable, StoryBand } from "@/components/stoop/home/story-band";
import { metaPostingEnabled } from "@/lib/config";
import { pickReceipts, postTimeline, storeShowcase, type TimelinePost } from "@/lib/marketing/landing-stores";
import { BEFORE_AFTER, DEMO_VIDEO, HERO, PILOT_CARD, PILOT_COPY, PILOT_LINE, PILOT_MEDIA, PILOT_RESULT, PILOT_RESULT_LABEL, POSTING_COPY, STORE_STORY, TABLE_PHOTO, TABLE_TITLE, WHO } from "@/lib/marketing/pilot";
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
  { name: "Community", line: "Qloo finds your city's music and places nearby, or a park for the table." },
  { name: "Create", line: "Pick the day and budget. Type your deals." },
  { name: "Event", line: "Stoop plans the food, music and a prize wheel or drop board." },
  { name: "Poster", line: "Your deals, word for word, ready to print." },
  { name: "Promote", line: "Posts for each channel. Nothing goes out without you." },
] as const;

/** A post's status, as a plain label (never a button): a check when it's ready, a clock when it's scheduled. */
function PostStatus({ post }: { post: TimelinePost }) {
  const Icon = post.status === "scheduled" ? Clock : Check;
  return (
    <span className="inline-flex items-start gap-1.5 text-[0.8125rem] font-medium text-fl-dark-dim">
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fl-signal" />
      {post.statusText}
    </span>
  );
}

export default function Home() {
  const slugs = recordedPlanSlugs();
  const lead = (slugs.find((s) => s === LEAD_PLAN_EXAMPLE.slug) ?? slugs[0])!;
  const stores = slugs.map((slug) => {
    const view = loadPlanExampleView(slug);
    const report = loadPlanExampleReport(slug);
    const city = PLAN_EXAMPLES.find((e) => e.slug === slug)?.city ?? view.header.cityLine;
    const show = storeShowcase(view, slug, city);
    return { slug, view, report, show, receipts: pickReceipts(view.receipts, show.picks.map((p) => p.receipt)) };
  });
  const leadStore = stores.find((s) => s.slug === lead)!;
  const leadView = leadStore.view;
  const leadHrefs = exampleHrefs(lead);
  const leadPoster = leadView.marketing.poster;
  const compare = landingCompare(leadView);
  const compareReceipts = pickReceipts(leadView.receipts, compare.flatMap((r) => [r.genericReceipt, r.stoopReceipt]));
  const posting = metaPostingEnabled();
  const postCopy = POSTING_COPY[posting ? "on" : "off"];
  const posts = postTimeline(PLAN_EXAMPLE_INPUTS[lead], posting);
  // Share mode readies every post the same way, so its status is said once, in the copy, not per post.
  const mixedStatus = new Set(posts.map((p) => p.statusText)).size > 1;
  const cityName = leadView.local.city?.name ?? leadStore.show.city;
  const heroMedia = PILOT_COPY ? PILOT_MEDIA : null;
  const tablePhoto = PILOT_COPY ? TABLE_PHOTO : null;
  // The comparison below is the lead store's, so the tabs open on another community and the lead store comes last.
  const tabStores = [...stores.filter((s) => s.slug !== lead), leadStore];

  return (
    <>
      <HomeNav />
      <main className="flex-1">
        {/*
          The hero is the experience: three short lines across the page, then the sentence and the two ways
          in beside the real table playing (under the buttons on phones). The H1 stays the largest paint:
          it runs the full width above the video, and the video is sized below it at every width.
        */}
        <section id="hero" aria-labelledby="hero-title" className="mx-auto max-w-[1248px] px-4 pt-8 pb-14 sm:px-8 lg:pt-14 lg:pb-24">
          <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-14">
            <p className="order-1 inline-flex min-h-8 items-center self-start rounded-full border border-fl-line bg-white px-3.5 py-1 text-[0.8125rem] font-medium lg:col-span-2 lg:justify-self-start">{HERO.eyebrow}</p>
            {/* Each sentence starts its own line; plain line breaks keep the H1 one element for the largest paint. */}
            <h1 id="hero-title" className="order-2 mt-6 font-serif text-[clamp(2.75rem,1rem+5vw,5.5rem)] leading-[1.02] font-normal tracking-[-0.02em] text-balance lg:col-span-2">
              {HERO.headline.map((line, i) => (
                <span key={line}>
                  {i > 0 && (
                    <>
                      {" "}
                      <br />
                    </>
                  )}
                  {/* The last two words stay together, so a phone never leaves one word alone on a line. */}
                  {line.replace(/ (\S+)$/, " $1")}
                </span>
              ))}
            </h1>
            <div className="order-3 flex flex-col lg:col-start-1 lg:row-start-3 lg:mt-10">
              <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-[1.5] text-pretty text-fl-muted lg:mt-0 lg:text-lg">{HERO.sub}</p>
              <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href="/start" className="inline-flex h-12 items-center justify-center rounded-[12px] bg-fl-ink px-6 text-base font-semibold text-white hover:bg-[#2a2a2e]">
                  Plan an event
                </Link>
                <Link href={leadHrefs.event} className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
                  See a real plan
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            </div>
            {/* Sized below the H1 at every width (20rem wide below desktop), so the words stay the largest paint. */}
            {heroMedia && <HeroVideo media={heroMedia} howItWent={tablePhoto ? "#real-table" : null} className="order-4 mt-8 w-full max-w-[20rem] lg:col-start-2 lg:row-start-3 lg:mt-10 lg:max-w-none lg:self-start" />}
            {PILOT_LINE && <p className="order-5 mt-4 text-sm text-fl-muted lg:col-start-1">{PILOT_LINE}</p>}
          </div>
        </section>

        {/* One trust row under the first screen, so the hero is only the words, the buttons and the table. */}
        <div className="border-y border-fl-rule">
          <ul aria-label="Why stores trust it" className="mx-auto flex max-w-[1248px] flex-col gap-2 px-4 py-4 text-sm text-fl-dim sm:flex-row sm:flex-wrap sm:gap-x-10 sm:px-8">
            {HERO.trust.map((t, i) => (
              <li key={t} className={cn("flex items-start gap-2", i === 0 && "font-medium text-fl-ink")}>
                <i aria-hidden="true" className="mt-[0.4375rem] block size-2 shrink-0 rounded-[2px] bg-fl-ink" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <BeforeAfter config={PILOT_COPY ? BEFORE_AFTER : null} />

        {/* One sequence: the problem (the story), proof in a real store, how Qloo decides, then why Qloo. */}
        <StoryBand story={STORE_STORY} />

        <RealTable title={TABLE_TITLE} photo={tablePhoto} result={PILOT_COPY ? PILOT_RESULT : null} resultLabel={PILOT_RESULT_LABEL} />

        <section id="examples" aria-labelledby="examples-title" className="scroll-mt-20 bg-fl-band">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
            <div className="flex flex-col gap-3">
              <p className={EYEBROW}>See it work</p>
              <h2 id="examples-title" className={H2}>
                Same table. Different community.
              </h2>
              <p className={LEDE}>Three example stores. Tap a pick for Qloo&apos;s reason.</p>
            </div>
            <StoreTabs
              label="Example stores"
              tabs={tabStores.map((s) => ({ slug: s.slug, storeName: s.show.storeName, city: s.show.city }))}
              panels={tabStores.map((s) => (
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
                <p className={LEDE}>Same model, same deals, no Qloo. Then Qloo checked its picks.</p>
              </div>
              <table className="mt-8 w-full text-[0.9375rem] leading-[1.45] md:table-fixed">
                <caption className="sr-only">The generic AI plan and Stoop&apos;s plan for {leadView.header.storeName}, line by line</caption>
                <thead className="max-md:sr-only">
                  <tr className="text-left text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase">
                    <th scope="col" className="w-28 pb-3 font-semibold lg:w-36">
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
                  {compare.map((r) => {
                    const row = r.row;
                    return (
                      <tr key={r.row} className="border-t border-fl-rule max-md:flex max-md:flex-col max-md:gap-2 max-md:py-4">
                        <th scope="row" className="py-4 pr-4 text-left align-top font-semibold max-md:p-0">
                          {row}
                        </th>
                        <td className="py-4 pr-8 align-top text-fl-muted max-md:p-0">
                          <span className="mb-0.5 block text-xs font-semibold tracking-[0.04em] text-fl-dim uppercase md:hidden">Generic AI plan</span>
                          {r.generic}
                          {r.genericReceipt && (
                            <>
                              {" "}
                              <ReceiptLink receiptKey={r.genericReceipt} href={`${leadHrefs.event}#compare`} className="text-sm font-medium whitespace-nowrap text-fl-ink underline underline-offset-[3px]" label={`Qloo's check of the generic plan's ${row.toLowerCase()}`}>
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
                              <ReceiptLink receiptKey={r.stoopReceipt} href={leadHrefs.event} className="text-sm font-medium whitespace-nowrap text-fl-ink underline underline-offset-[3px]" label={`Receipt: why Qloo picked the ${row.toLowerCase()}`}>
                                Receipt
                              </ReceiptLink>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-4 text-[0.8125rem] text-fl-dim">
                {cityName} example, recorded {stampDate(leadStore.report.meta.createdAt)}.{" "}
                <Link href={`${leadHrefs.event}#compare`} className="font-medium text-fl-ink underline underline-offset-[3px]">
                  See the whole comparison
                </Link>
              </p>
            </FloorReceipts>
          </section>
        )}

        <section id="how" aria-labelledby="how-title" className="scroll-mt-20 border-t border-fl-rule">
          <div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 py-16 sm:px-8 lg:py-24">
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
                    <span className="flex size-6 items-center justify-center rounded-full bg-fl-ink font-mono text-xs text-white">{i + 1}</span>
                    {s.name}
                  </p>
                  <p className="text-[0.9375rem] leading-[1.45] text-pretty text-fl-muted">{s.line}</p>
                </li>
              ))}
            </ol>
            <DemoVideoSlot video={DEMO_VIDEO} />
          </div>
        </section>

        <section aria-labelledby="posts-title" className="floor-dark bg-fl-dark text-fl-dark-bright">
          <div className="mx-auto grid max-w-[1248px] grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-16 lg:py-24">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold tracking-[0.02em] text-fl-dark-dim">Promote</p>
              <h2 id="posts-title" className={H2}>
                {postCopy.title}
              </h2>
              <p className="text-lg leading-[1.5] text-pretty text-fl-dark-dim">{postCopy.body}</p>
              <p className="text-sm text-fl-dark-dim">{postCopy.note}</p>
            </div>
            <div className="flex flex-col gap-4">
              {/* The page's one example poster: small, beside what it comes with, never leading. */}
              {leadPoster.medium && (
                <figure className="flex items-center gap-4">
                  <Link href={leadHrefs.poster} className="block w-24 shrink-0 rounded-[8px] sm:w-28">
                    <Image src={leadPoster.medium} alt={leadPoster.alt} width={720} height={900} unoptimized loading="lazy" className="aspect-[4/5] h-auto w-full rounded-[8px] bg-fl-dark-2 object-cover" />
                  </Link>
                  <figcaption className="text-[0.9375rem] leading-[1.45] text-pretty">Every plan comes with a poster and the posts.</figcaption>
                </figure>
              )}
              {/* The example's send times, in its own calendar: the announcement, then the reminders. Cells grow
                  to fill each row, so 4 or 5 posts never leave an empty slot. */}
              <ol aria-label="When the posts go out" className="flex flex-wrap gap-px overflow-hidden rounded-[20px] bg-fl-dark-rule">
                {posts.map((p) => (
                  <li key={p.title} className="flex min-w-0 flex-[1_1_7.5rem] flex-col gap-0.5 bg-fl-dark-2 px-4 py-3.5">
                    <span className="font-mono text-[0.9375rem] font-semibold tabular-nums">{p.when}</span>
                    <span className="text-[0.8125rem] text-fl-dark-dim">{p.title}</span>
                    {mixedStatus && <PostStatus post={p} />}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Who it's for beside the Reserve card: the founder's story opens the page, right after the hero. */}
        <section aria-labelledby="who-title" className="mx-auto grid max-w-[1248px] gap-10 px-4 py-16 sm:px-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-24">
          <div className="flex flex-col gap-4">
            <h2 id="who-title" className={EYEBROW}>
              Who it&apos;s for
            </h2>
            <ul className="[&>li+li]:border-t [&>li+li]:border-fl-rule">
              {WHO.map((w) => (
                <li key={w.title} className="flex flex-col gap-0.5 py-4">
                  <h3 className="text-[1.0625rem] font-semibold">{w.title}</h3>
                  <p className="text-[0.9375rem] text-pretty text-fl-muted">{w.line}</p>
                </li>
              ))}
            </ul>
          </div>
          {/* My stores stays one tap away in the header and the footer. */}
          <ReserveStores title={PILOT_CARD.title} line={PILOT_CARD.line} />
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
