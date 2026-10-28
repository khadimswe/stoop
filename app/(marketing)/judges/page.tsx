import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { examplePlanId, examplePlanPath, LEAD_PLAN_EXAMPLE } from "@/lib/plan/example-list";
import { codeUrl } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "For judges · Stoop",
  description: "A one-minute path through Stoop: an example store's plan, one Qloo receipt and the generic AI plan beside it.",
};

// Static: recorded example stores only.
export const ensureStatic = "navigation";

const LEAD = examplePlanPath(LEAD_PLAN_EXAMPLE.slug);

const PATH = [
  { title: "Open a store", line: `${LEAD_PLAN_EXAMPLE.storeName}, ${LEAD_PLAN_EXAMPLE.city}: the event at a glance.`, href: LEAD, cta: "Open the plan" },
  { title: "Tap a receipt", line: "Why Qloo picked this: the exact query, never the key.", href: `${LEAD}#event`, cta: "See the plan lines" },
  { title: "Compare", line: "Open Compare with a generic AI plan. Clichés struck through.", href: `${LEAD}#event`, cta: "Go to the plan" },
  { title: "Plan your own", line: "Your store, the day, your promos.", href: "/start", cta: "Plan an event" },
] as const;

const DECIDES = [
  { call: "/v2/insights · artist", how: "signal.location.query = the city", decides: "The city's music: artists and the styles they share.", code: "lib/plan/requests.ts" },
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
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-14 px-5 pt-10 pb-20 sm:pt-14">
      <div className="flex flex-col gap-3">
        <h1 className="type-h2">For judges</h1>
        <p className="type-lead max-w-[36em] text-pretty text-ink-soft">Every store runs the same table outside. Stoop plans the one its block wants, with Qloo deciding the music and the spots.</p>
      </div>

      <section aria-labelledby="path-title" className="flex flex-col gap-5">
        <h2 id="path-title" className="font-display text-2xl font-extrabold [font-stretch:85%]">
          The one-minute path
        </h2>
        <ol className="grid gap-x-8 gap-y-6 border-t-2 border-ink pt-6 sm:grid-cols-2">
          {PATH.map((step, i) => (
            <li key={step.title} className="flex flex-col items-start gap-1.5">
              <span className="font-mono text-sm text-ink-soft">{i + 1}</span>
              <h3 className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">{step.title}</h3>
              <p className="text-base text-pretty text-ink-soft">{step.line}</p>
              <Link href={step.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold underline decoration-2 underline-offset-4 hover:decoration-brick">
                {step.cta}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ol>
        <div>
          <Button asChild size="lg">
            <Link href={LEAD}>Open the example store</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="decides-title" className="flex flex-col gap-4">
        <h2 id="decides-title" className="font-display text-2xl font-extrabold [font-stretch:85%]">
          What Qloo decides
        </h2>
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Each Qloo call and what it decides</caption>
            <thead className="max-md:sr-only">
              <tr className="border-b border-hairline text-left font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">
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
                <tr key={d.call} className="border-b border-hairline last:border-b-0 max-md:grid max-md:gap-1 max-md:px-4 max-md:py-3">
                  <th scope="row" className="text-left align-top font-normal md:px-4 md:py-3">
                    <span className="block font-mono">{d.call}</span>
                    <span className="block font-mono text-xs text-ink-soft">{d.how}</span>
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
        <p className="text-sm text-ink-soft">The city sets the music; the block sets the food and partners. Qloo has no reliable read on one neighborhood, so Stoop doesn&apos;t claim one.</p>
      </section>

      <section aria-labelledby="rules-title" className="flex flex-col gap-4">
        <h2 id="rules-title" className="font-display text-2xl font-extrabold [font-stretch:85%]">
          Honest by design
        </h2>
        <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {RULES.map((r) => (
            <li key={r} className="border-b border-hairline py-2 text-base text-pretty">
              {r}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="more-title" className="flex flex-col gap-3">
        <h2 id="more-title" className="font-display text-2xl font-extrabold [font-stretch:85%]">
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
  );
}
