import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY_INLINE } from "@/components/stoop/floor/kit";
import { HomeNav } from "@/components/stoop/home/home-nav";
import { metaPostingEnabled } from "@/lib/config";
import { examplePlanId, LEAD_PLAN_EXAMPLE } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { genericCheckWords } from "@/lib/marketing/plain-words";
import { codeUrl } from "@/lib/marketing/site";
import { loadPlanExampleView, recordedPlanSlugs } from "@/lib/plan/view/load";

export const metadata: Metadata = {
  title: "For judges · Stoop",
  description: "A short path through Stoop: three example stores, one plan's Qloo receipts, the generic AI plan beside it, then your own store.",
};

// Static: recorded example stores only.
export const ensureStatic = "navigation";

const LEAD = exampleHrefs(LEAD_PLAN_EXAMPLE.slug).event;
const HOUSTON = exampleHrefs("houston-east-end").event;

/**
 * The steps. The comparison's line says what Qloo found for the lead example's generic playlist,
 * from its recorded run ("none of its 3 artists make Qloo's own top 20 for Chicago adults 25 to 34").
 */
function pathSteps(check: string | null) {
  return [
    {
      title: "Same table. Different community.",
      line: "On the landing, three example stores with the same kind of deals get three different plans: different music, food spots and prizes, each picked by Qloo for that city and the places around that store.",
      href: "/#examples",
      cta: "See the three stores",
    },
    {
      title: "One event and its receipts",
      line: `${LEAD_PLAN_EXAMPLE.storeName}, ${LEAD_PLAN_EXAMPLE.city}. Tap "Why Qloo picked this" on the playlist, a food spot or a gift card: the exact Qloo request behind it (never the API key).`,
      href: `${LEAD}#receipt-play`,
      cta: "Open a receipt",
    },
    {
      title: "The generic AI plan beside it",
      line: `The same model, the same inputs, no Qloo. It names no place near the store, and ${check ?? "the famous artists it picks fall outside Qloo's own top picks for that city and those ages"}.`,
      href: `${LEAD}#compare`,
      cta: "Open the comparison",
    },
    {
      title: "The first real table",
      line: "Oct 30, at the founder's store in Kennesaw, GA: the first table Stoop planned, with a photo, the drop board and what the store saw that day, labeled as one day.",
      href: "/#real-table",
      cta: "See the real table",
    },
    {
      title: "Take it to where people go",
      line: 'On the Houston example, Qloo\'s parks and venues near the store have "Plan it here", and the event has "Get the OK": drafts to the district manager and the organizer.',
      href: `${HOUSTON}#get-the-ok`,
      cta: "Open the drafts",
    },
    {
      title: "Try your own store",
      line: "Type a store's name and address, see its community, then plan the event. When live plans are off, Stoop says so plainly and opens the closest example store instead (same city, else same state, else the nearest), so nothing ever breaks.",
      href: "/start",
      cta: "Plan an event",
    },
  ] as const;
}

const DECIDES = [
  {
    call: "/v2/insights · artist",
    how: "signal.location.query = the city, signal.demographics.age = the store's adult age bands",
    decides: "The playlist: the artists the city ranks highest for those ages.",
    code: "lib/plan/requests.ts",
  },
  {
    call: "/v2/insights · place",
    how: "filter.location = the store's POINT, filter.location.radius = 1500 (about 1 mile), one category per call, explainability",
    decides: "The community: food spots, cafes, venues and parks near the store, each with Qloo's reason. The food spot, the gift cards, any partner and any venue for the table come only from these.",
    code: "lib/plan/taste.ts",
  },
  {
    call: "/v2/insights · artist by places",
    how: "signal.interests.entities = venues in the community",
    decides: "A second music option: what people who love the community's top local spots play. Offered only when it is current and adds artists the city's list lacks, and always next to the city's music.",
    code: "lib/plan/block-music.ts",
  },
  {
    call: "/search, then /v2/insights · scoring",
    how: "the generic plan's artist names, then one filter.results.entities call against the city's own picks",
    decides: "Ranks the generic plan's artists against the city's own picks, all in one call, so the comparison is fair.",
    code: "lib/plan/baseline.ts",
  },
] as const;

export default function JudgesPage() {
  const rules = [
    "Every music, food and venue pick has a receipt, or says it isn't from Qloo.",
    "Every place and artist named in a plan comes from that store's own Qloo results.",
    "Deals are quoted word for word, as the manager typed them.",
    metaPostingEnabled() ? "Nothing posts without the manager's tap." : "Stoop writes the posts; the manager shares them. Nothing goes out on its own.",
    "Example stores are fictional. No carrier logos.",
    "One real result, from one day, labeled as a first look, not proof. The pilot keeps counting at both stores.",
  ];
  const lead = recordedPlanSlugs().includes(LEAD_PLAN_EXAMPLE.slug) ? loadPlanExampleView(LEAD_PLAN_EXAMPLE.slug) : null;
  const steps = pathSteps(lead ? genericCheckWords(lead, true) : null);
  return (
    <>
      <HomeNav />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 px-4 pt-10 pb-20 sm:px-8 sm:pt-14">
        <div className="flex flex-col gap-3">
          <h1 className="font-serif text-[clamp(2.125rem,1.5rem+2.5vw,3.375rem)] leading-[1.06] font-normal text-balance">For judges</h1>
          <p className="max-w-[36em] text-lg leading-[1.5] text-pretty text-fl-muted">
            Every prepaid store runs the same table outside. Stoop plans one for the community around it, with Qloo&apos;s taste data deciding the music (from the city) and the food spots, prizes and venues (from the places near the store).
          </p>
        </div>

        <section aria-labelledby="path-title" className="flex flex-col gap-5">
          <h2 id="path-title" className="font-serif text-[1.75rem] leading-tight font-normal">
            The path, in {steps.length} steps
          </h2>
          <ol className="grid gap-x-8 gap-y-6 border-t border-fl-ink pt-6 sm:grid-cols-2">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col items-start gap-1.5">
                <span className="text-sm font-semibold text-fl-dim tabular-nums">{i + 1}</span>
                <h3 className="text-lg leading-tight font-semibold">{step.title}</h3>
                <p className="text-base text-pretty text-fl-muted">{step.line}</p>
                <Link href={step.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
                  {step.cta}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </li>
            ))}
          </ol>
          <div>
            <Link href={LEAD} className={PRIMARY_INLINE}>
              Open the example event
            </Link>
          </div>
        </section>

        <section aria-labelledby="decides-title" className="flex flex-col gap-4">
          <h2 id="decides-title" className="font-serif text-[1.75rem] leading-tight font-normal">
            What Qloo decides
          </h2>
          <div className="overflow-hidden rounded-[20px] border border-fl-rule bg-white">
            <table className="w-full text-sm">
              <caption className="sr-only">Each Qloo call and what it decides</caption>
              <thead className="max-md:sr-only">
                <tr className="border-b border-fl-rule text-left font-mono text-[0.6875rem] tracking-wide text-fl-muted uppercase">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Call
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Decides
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Code
                  </th>
                </tr>
              </thead>
              <tbody>
                {DECIDES.map((d) => (
                  <tr key={d.call} className="border-b border-fl-rule last:border-b-0 max-md:grid max-md:gap-1 max-md:px-4 max-md:py-3">
                    <th scope="row" className="text-left align-top font-normal md:w-[38%] md:px-4 md:py-3">
                      <span className="block font-mono">{d.call}</span>
                      <span className="block font-mono text-xs break-words text-fl-muted">{d.how}</span>
                    </th>
                    <td className="align-top text-pretty md:px-4 md:py-3">{d.decides}</td>
                    <td className="align-top md:px-4 md:py-3">
                      <a href={codeUrl(d.code)} className="font-mono text-xs whitespace-nowrap underline underline-offset-4">
                        {d.code}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-pretty text-fl-muted">
            The city sets the music; the places Qloo finds near the store set the food, the gift cards and the partners. In our tests a neighborhood point barely changed Qloo&apos;s taste results, so Stoop never claims a neighborhood&apos;s taste, and it never treats a shop&apos;s own Qloo profile as the taste of the people who go there.
          </p>
        </section>

        <section aria-labelledby="rules-title" className="flex flex-col gap-4">
          <h2 id="rules-title" className="font-serif text-[1.75rem] leading-tight font-normal">
            Honest by design
          </h2>
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {rules.map((r) => (
              <li key={r} className="border-b border-fl-rule py-2 text-base text-pretty">
                {r}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="more-title" className="flex flex-col gap-3">
          <h2 id="more-title" className="font-serif text-[1.75rem] leading-tight font-normal">
            Also look at
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
            <li>
              <Link href="/stores" className="inline-flex min-h-11 items-center underline underline-offset-4">
                My stores
              </Link>
            </li>
            <li>
              <Link href={`/e/${examplePlanId(LEAD_PLAN_EXAMPLE.slug)}`} className="inline-flex min-h-11 items-center underline underline-offset-4">
                The public event page
              </Link>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
