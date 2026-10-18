import { ArrowRight, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Chip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import { EXAMPLES, LEAD_EXAMPLE } from "@/lib/demo/examples";
import { scoreboardRow } from "@/lib/marketing/landing";
import { codeUrl, REPO_URL } from "@/lib/marketing/site";
import { loadExampleReport } from "@/lib/report/load";
import { formatDate } from "@/lib/report/view/format";

export const metadata: Metadata = {
  title: "For judges · Stoop",
  description: "A 90-second path through Stoop: the Reality Check, the Screening Room and one receipt, plus everything Qloo decides.",
};

// Static: recorded runs only.
export const ensureStatic = "navigation";

const LEAD = `/examples/${LEAD_EXAMPLE.slug}`;

const PATH = [
  {
    title: "The Reality Check",
    line: `Open the ${LEAD_EXAMPLE.brandName} report. The top shows what the brand said, what Qloo measured for its taste neighborhood, and what a generic AI brief assumed.`,
    href: LEAD,
    cta: "Open the report",
  },
  {
    title: "The Screening Room",
    line: "Scroll to the Screening Room: the Control, made from an LLM-only brief, next to one ad per concept world. Same template, same model, only the brief changes.",
    href: `${LEAD}#screening`,
    cta: "Go to the Screening Room",
  },
  {
    title: "One receipt",
    line: "Tap any Qloo chip. The drawer shows the exact query, whether it came from cache, the rank and the panel position. The API key never appears.",
    href: `${LEAD}#reality`,
    cta: "Open a receipt",
  },
  {
    title: "Try it free",
    line: "Paste a product link, or describe the product, and watch the agent work.",
    href: "/start",
    cta: "Try it free",
  },
] as const;

const DECIDES: { call: string; type: string | null; decides: string; code: string }[] = [
  {
    call: "/search",
    type: null,
    decides:
      "Resolves each seed. A suggestion is kept only when Qloo's name matches it, or when Qloo's name starts or ends with the whole suggestion (marked in the receipt); anything else is dropped.",
    code: "lib/qloo/match.ts",
  },
  { call: "/v2/tags", type: null, decides: "Turns a product page into taste tags offered as seeds.", code: "lib/intake/tags.ts" },
  { call: "/v2/insights", type: "urn:demographics", decides: "Age and gender skews for the taste neighborhood: relative indices from -1 to 1, never shares.", code: "lib/stages/prove.ts" },
  { call: "/v2/insights", type: "urn:heatmap", decides: "Where it clusters. Cities are ranked by lift against reference audiences, and a city sets the setting, never the cast.", code: "lib/geo/metros.ts" },
  { call: "/v2/insights", type: "urn:tag", decides: "The music genres and emotional tone the audience over-indexes on.", code: "lib/stages/prove.ts" },
  {
    call: "/v2/insights",
    type: "artist, brand, movie, tv_show, place, person, podcast",
    decides: "Each concept world's Culture Brief: music feel, visual language, wardrobe, setting (with Qloo's explainability), voice and creators.",
    code: "lib/stages/culture.ts",
  },
  {
    call: "/v2/insights",
    type: "filter.results.entities, filter.results.tags",
    decides: "Scores Qloo's picks and the generic brief's picks against frozen reference panels in one call, so ranks compare fairly. Below the median is a cliche.",
    code: "lib/stages/check.ts",
  },
];

export default function JudgesPage() {
  const scoreboard = EXAMPLES.map(({ slug }) => scoreboardRow(slug, loadExampleReport(slug)));
  const recorded = formatDate(loadExampleReport(LEAD_EXAMPLE.slug).meta.createdAt);

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl flex-col gap-6 px-5 pt-12 pb-12 sm:pt-16">
        <p className="type-kicker text-ink-soft">Judge&apos;s guide</p>
        <h1 className="type-hero text-balance" style={{ fontSize: "clamp(3rem, 6vw, 5.25rem)" }}>
          For judges
        </h1>
        <p className="type-lead max-w-[40em] text-pretty text-ink-soft">
          A 90-second path through Stoop: the Reality Check, the Screening Room and one receipt. The examples run on recorded Qloo responses, so
          they load instantly and make no live calls.
        </p>
        <p className="max-w-[46rem] rounded-card border-2 border-ink bg-surface p-5 text-lg leading-snug font-semibold text-pretty shadow-float sm:p-6">
          Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.
        </p>
      </header>

      <Section id="path" kicker="Start here" title="The 90-second path">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PATH.map((step, i) => (
            <li key={step.title} className="flex min-w-0 flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
              <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-ink font-mono text-sm font-medium text-paper">
                {i + 1}
              </span>
              <h3 className="font-display text-xl leading-tight font-extrabold [font-stretch:88%]">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="text-[0.95rem] leading-snug text-pretty text-ink-soft">{step.line}</p>
              <div className="mt-auto pt-1">
                {i === 0 ? (
                  <Button asChild>
                    <Link href={step.href}>
                      {step.cta}
                      <ArrowRight data-icon="inline-end" aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Link href={step.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
                    {step.cta}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="qloo"
        kicker="Receipts"
        title="What Qloo decides"
        lead="Every audience fact and every creative ingredient comes from one of these calls. Each call goes through one client that validates its params, caches, paces and counts it, and returns a receipt."
      >
        <div className="overflow-hidden rounded-card border border-hairline bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Each Qloo call Stoop makes, what it decides and where the code is</caption>
            <thead className="hidden bg-fill text-xs tracking-wide text-ink-soft uppercase md:table-header-group">
              <tr>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Qloo call
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  What it decides
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Code
                </th>
              </tr>
            </thead>
            <tbody>
              {DECIDES.map((row) => (
                <tr key={`${row.call}-${row.type}`} className="flex flex-col gap-1.5 border-t border-hairline px-5 py-4 first:border-t-0 md:table-row md:px-0 md:py-0">
                  <th scope="row" className="font-mono text-[0.8125rem] font-medium md:px-5 md:py-4 md:align-top">
                    {row.call}
                    {row.type && <span className="block text-ink-soft">{row.type}</span>}
                  </th>
                  <td className="leading-snug text-pretty md:px-5 md:py-4 md:align-top">{row.decides}</td>
                  <td className="md:px-5 md:py-4 md:align-top">
                    <a href={codeUrl(row.code)} className="inline-flex min-h-9 items-center gap-1 font-mono text-[0.8125rem] text-ink underline underline-offset-4">
                      {row.code}
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-ink-soft">
          The client lives in{" "}
          <a href={codeUrl("lib/qloo/client.ts")} className="font-mono text-ink underline underline-offset-4">
            lib/qloo/client.ts
          </a>
          . Qloo ignores invalid params without an error, so every request is checked against a schema per type before it is sent.
        </p>
      </Section>

      <Section id="rules" kicker="Grounding" title="How Qloo decides every fact and cue">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <ul className="flex flex-col gap-4 text-base leading-relaxed">
            <Rule>The model plans and writes, but it may only cite entities and tags Qloo returned in this run. It returns ids; names come from the run&apos;s own ledger, and anything else is rejected.</Rule>
            <Rule>Every audience fact and creative cue carries a receipt: the endpoint, the query with the key left out, whether it came from cache, and its rank or panel position (&ldquo;beats 24 of 24 reference artists&rdquo;).</Rule>
            <Rule>A brief field Qloo has no evidence for reads &ldquo;No Qloo signal&rdquo;, or carries a cue labeled &ldquo;Creative suggestion (not from Qloo)&rdquo;. Tempo, camera and lens are never Qloo&apos;s.</Rule>
            <Rule>Film and TV affinities become visual language, artist affinities become music feel. Prompts never name a real artist, song, film or brand.</Rule>
            <Rule>The generic Control runs the same product through the same template with no Qloo tools, then gets scored by Qloo. That is the with-vs-without below.</Rule>
          </ul>
          <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-5">
            <h3 className="font-display text-lg font-extrabold [font-stretch:88%]">Every cue says where it came from</h3>
            <dl className="flex flex-col gap-3 text-sm">
              <Legend chip={<Chip origin="qloo">Qloo</Chip>}>Qloo returned it.</Legend>
              <Legend chip={<Chip origin="interpreted">From Qloo</Chip>}>Plain wording that cites Qloo results.</Legend>
              <Legend chip={<Chip origin="creative">Not from Qloo</Chip>}>A creative suggestion, labeled as one.</Legend>
              <Legend chip={<Chip origin="yours">Your choice</Chip>}>Something you picked or edited.</Legend>
              <Legend chip={<Chip origin="flagged">Flagged</Chip>}>A cliche Qloo&apos;s data does not support.</Legend>
            </dl>
          </div>
        </div>
      </Section>

      <Section
        id="scoreboard"
        kicker="With vs without"
        title="The generic brief, scored by Qloo"
        lead="For each example, the LLM-only brief's checkable choices, placed against what Qloo measured for each concept world. The lines are the check's own words."
      >
        <ul className="grid gap-4 lg:grid-cols-3">
          {scoreboard.map((row) => (
            <li key={row.slug} className="flex min-w-0 flex-col gap-4 rounded-card border border-hairline bg-surface p-5">
              <div className="flex flex-col gap-1">
                <h3 className="type-h3">{row.brand}</h3>
                {row.headline && <p className="text-base leading-snug font-semibold">{row.headline}</p>}
              </div>
              <ul className="flex flex-col gap-4">
                {row.worlds.map((world) => (
                  <li key={world.label} className="flex flex-col gap-1.5 border-t border-hairline pt-3 text-sm leading-snug">
                    <p className="font-semibold">{world.label}</p>
                    <p>{world.control}.</p>
                    <p className="text-ink-soft">{world.qloo}.</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {world.cliches > 0 && (
                        <Chip origin="flagged">
                          {world.cliches} {world.cliches === 1 ? "cliche" : "cliches"} flagged
                        </Chip>
                      )}
                      {world.receipt && (
                        <ReceiptDrawer receipt={world.receipt}>
                          <Button variant="link" size="sm" className="h-11 text-ink">
                            See the receipts<span className="sr-only">: {world.label}</span>
                          </Button>
                        </ReceiptDrawer>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Link href={row.href} className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
                Open {row.brand}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="limits" kicker="Data, not stereotypes." title="Guardrails and honest limits">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-extrabold [font-stretch:88%]">Guardrails</h3>
            <ul className="flex flex-col gap-3 text-base leading-relaxed">
              <Rule>Every audience is 18 or older. The youngest band reads 18 to 24, all talent is adult, and settings never imply minors.</Rule>
              <Rule>Segments come from Qloo affinities and skews, never from a race or ethnicity label. They are named by what Qloo measured.</Rule>
              <Rule>Cities come from Qloo&apos;s heatmap, with a receipt. A city sets the setting, never the cast.</Rule>
              <Rule>Music is described as a style. No celebrity likenesses and no third-party logos.</Rule>
              <Rule>Nothing auto-publishes. Every pack ends with a human review checklist and an AI disclosure note.</Rule>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="font-display text-xl font-extrabold [font-stretch:88%]">Honest limits</h3>
            <ul className="flex flex-col gap-3 text-base leading-relaxed">
              <Rule>Without store data, Stoop measures your product&apos;s taste neighborhood. Precision mode (roadmap) adds real order data.</Rule>
              <Rule>Demographics are relative skews, not shares of an audience: &ldquo;skews +0.21&rdquo;, never a percentage.</Rule>
              <Rule>Ranks are compared only inside one Qloo response. A near tie is called a near tie, never a gap.</Rule>
              <Rule>The examples are fictional brands. Their runs use real Qloo responses, recorded on {recorded}.</Rule>
              <Rule>No performance claims: a measured ad-spend pilot is planned for November.</Rule>
            </ul>
          </div>
        </div>
      </Section>

      <Section id="camera" kicker="Video" title="Stoop is the brain, you bring your own camera.">
        <div className="grid gap-6 md:grid-cols-2">
          <p className="text-base leading-relaxed text-pretty text-ink-soft">
            Stoop decides who each ad is for and what it should feel like, then writes a Production Pack for the video tool you already use: asset
            sheet prompts, scene prompts that reference them, a critique checklist and a Director&apos;s Guide. Copy a prompt into Higgsfield, Veo,
            Kling or Runway, or use Stoop inside Claude.
          </p>
          <div className="flex flex-col items-start gap-3 rounded-card border border-hairline bg-surface p-5">
            <p className="type-kicker text-ink-soft">Power-user note</p>
            <p className="text-base leading-snug font-semibold">Stoop&apos;s MCP plus your own Higgsfield MCP</p>
            <p className="text-sm leading-relaxed text-ink-soft">
              Add both to Claude. Stoop decides who the ad is for and what culture it draws on; Higgsfield renders it on your own account.
            </p>
            <Link href="/mcp" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
              Get an MCP token
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </Section>

      <Section id="roadmap" kicker="Roadmap" title="Next: Precision mode">
        <div className="flex flex-col gap-4">
          <p className="max-w-[44rem] text-lg leading-relaxed text-pretty">
            Precision mode: connect your Shopify store so real order locations and best-sellers sharpen Qloo&apos;s picture. Aggregated, no customer
            PII.
          </p>
          <p className="max-w-[44rem] text-base text-ink-soft">It ships as a Shopify App Store app. Qloo works from aggregate taste data, never individual accounts.</p>
          <a href={REPO_URL} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
            Read the code on GitHub
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </div>
      </Section>
    </main>
  );
}

function Section({ id, kicker, title, lead, children }: { id: string; kicker: string; title: string; lead?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-6 px-5 pb-16">
      <div className="flex max-w-[46rem] flex-col gap-2 border-t-2 border-ink pt-6">
        <p className="type-kicker text-ink-soft">{kicker}</p>
        <h2 id={`${id}-title`} className="font-display text-[2rem] leading-[1.02] font-extrabold tracking-tight text-balance [font-stretch:82%] sm:text-[2.5rem]">
          {title}
        </h2>
        {lead && <p className="text-base leading-relaxed text-pretty text-ink-soft">{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-ink" />
      <span className="text-pretty">{children}</span>
    </li>
  );
}

function Legend({ chip, children }: { chip: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <dt>{chip}</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  );
}
