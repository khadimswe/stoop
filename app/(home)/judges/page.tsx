import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PRIMARY } from "@/components/stoop/floor/kit";
import { HomeNav } from "@/components/stoop/home/home-nav";
import { examplePlanId, LEAD_PLAN_EXAMPLE } from "@/lib/plan/example-list";
import { exampleHrefs } from "@/lib/plan/view/hrefs";
import { codeUrl } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "For judges · Stoop",
  description: "A one-minute path through Stoop: an example store's plan, one Qloo receipt and the generic AI plan beside it.",
};

// Static: recorded example stores only.
export const ensureStatic = "navigation";

const LEAD = exampleHrefs(LEAD_PLAN_EXAMPLE.slug).event;

const PATH = [
  { title: "Open a store", line: `${LEAD_PLAN_EXAMPLE.storeName}, ${LEAD_PLAN_EXAMPLE.city}: the block, then the event.`, href: exampleHrefs(LEAD_PLAN_EXAMPLE.slug).block, cta: "Open the block" },
  { title: "Tap a receipt", line: "Why Qloo picked this: the exact query, never the key.", href: `${LEAD}#receipt-play`, cta: "Open a receipt" },
  { title: "Compare", line: "The generic AI plan beside this one, clichés named.", href: `${LEAD}#compare`, cta: "Open the comparison" },
  { title: "Plan your own", line: "Your store, the day, your promos.", href: "/start", cta: "Plan an event" },
] as const;

const DECIDES = [
  { call: "/v2/insights · artist", how: "signal.location.query = the city", decides: "The playlist: artists the city ranks for these ages.", code: "lib/plan/requests.ts" },
  { call: "/v2/insights · place", how: "filter.location = the store's point, a radius, explainability", decides: "The block: food spots, venues and parks, with Qloo's why.", code: "lib/plan/taste.ts" },
  { call: "/v2/insights · scoring", how: "one call against the city's own picks", decides: "Checks the generic plan's artists against the city.", code: "lib/plan/baseline.ts" },
] as const;

const RULES = [
  "Every music, food and venue pick has a receipt, or says it isn't from Qloo.",
  "Names come only from the run's own Qloo results.",
  "Promos are quoted exactly as the store typed them.",
  "Nothing posts without the manager's tap.",
  "Example stores are fictional. No carrier logos.",
  "No traffic or sales claims: a store pilot measures that.",
] as const;

export default function JudgesPage() {
  return (
    <>
    <HomeNav />
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 px-4 pt-10 pb-20 sm:px-8 sm:pt-14">
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-[2.125rem] leading-[1.06] font-normal lg:text-[3.375rem]">For judges</h1>
        <p className="max-w-[36em] text-lg leading-[1.5] text-pretty text-fl-muted">Every store runs the same table outside. Stoop plans the one its block wants, with Qloo deciding the music and the spots.</p>
      </div>

      <section aria-labelledby="path-title" className="flex flex-col gap-5">
        <h2 id="path-title" className="font-serif text-[1.75rem] leading-tight font-normal">
          The one-minute path
        </h2>
        <ol className="grid gap-x-8 gap-y-6 border-t border-fl-ink pt-6 sm:grid-cols-2">
          {PATH.map((step, i) => (
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
          <Link href={LEAD} className={PRIMARY + " w-auto px-6"}>
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
                  <th scope="row" className="text-left align-top font-normal md:px-4 md:py-3">
                    <span className="block font-mono">{d.call}</span>
                    <span className="block font-mono text-xs text-fl-muted">{d.how}</span>
                  </th>
                  <td className="align-top md:px-4 md:py-3">{d.decides}</td>
                  <td className="align-top md:px-4 md:py-3">
                    <a href={codeUrl(d.code)} className="font-mono text-xs underline underline-offset-4">
                      {d.code}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-fl-muted">The city sets the music; the block sets the food and partners. Qloo has no reliable read on one neighborhood, so Stoop doesn&apos;t claim one.</p>
      </section>

      <section aria-labelledby="rules-title" className="flex flex-col gap-4">
        <h2 id="rules-title" className="font-serif text-[1.75rem] leading-tight font-normal">
          Honest by design
        </h2>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {RULES.map((r) => (
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
          <li>
            <Link href="/ads" className="inline-flex min-h-11 items-center underline underline-offset-4">
              Stoop&apos;s first product: ads
            </Link>
          </li>
        </ul>
      </section>
    </main>
    </>
  );
}
