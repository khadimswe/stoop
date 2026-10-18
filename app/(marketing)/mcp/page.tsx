import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ExampleSession } from "@/components/stoop/marketing/example-session";
import { McpTokenForm } from "@/components/stoop/marketing/mcp-token-form";
import { SetupSnippets } from "@/components/stoop/marketing/setup-snippets";
import { Screen } from "@/components/stoop/screen";
import { judgingEndsAt, mcpCaps } from "@/lib/config";
import { expiryText } from "@/lib/marketing/mcp-token";
import { siteOrigin } from "@/lib/marketing/site";

export const metadata: Metadata = {
  title: "Use Stoop inside your Claude · Stoop",
  description: "Works inside your Claude, with your own video tools: score a brief against Qloo's taste data, or start a full Culture Brief.",
};

// Static: no request data. The snippets show the page's own origin once they hydrate.
export const ensureStatic = "navigation";

const ORIGIN = siteOrigin(process.env.NEXT_PUBLIC_APP_URL);
/** When every token stops working (JUDGING_ENDS_AT, read at build time). */
const EXPIRES = new Date(judgingEndsAt()).toISOString();
/** The per-token caps the endpoint enforces (lib/config.ts mcpCaps). */
const PER_TOKEN = mcpCaps().perToken;

export default function McpPage() {
  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-12 gap-y-10 px-5 pt-12 pb-16 sm:pt-16">
        <div className="flex min-w-0 flex-[1_1_24rem] flex-col gap-5">
          <p className="type-kicker text-ink-soft">Stoop in Claude</p>
          <h1 className="type-hero text-balance" style={{ fontSize: "clamp(2.75rem, 5.4vw, 4.75rem)" }}>
            Use Stoop inside your Claude
          </h1>
          <p className="font-display text-[1.375rem] leading-snug font-bold text-balance [font-stretch:90%] sm:text-[1.625rem]">
            Works inside your Claude, with your own video tools.
          </p>
          <p className="max-w-[40em] text-base leading-relaxed text-pretty text-ink-soft sm:text-lg">
            Two tools: <code className="font-mono text-[0.9em] text-ink">score_brief</code> checks the creative choices in any brief against
            Qloo&apos;s taste data, and <code className="font-mono text-[0.9em] text-ink">culture_brief</code> starts a full run and sends back the
            report link.
          </p>
        </div>
        {/* The founder records a 30 to 60 s capture for this slot. Until then, a labeled screen: never a fake video. */}
        <figure className="flex min-w-0 flex-[1_1_28rem] flex-col gap-2">
          <Screen className="flex aspect-video w-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="font-mono text-xs tracking-widest text-paper-dim uppercase">Screen capture coming</p>
            <p className="max-w-[24rem] text-sm text-paper-dim">A short recording of Stoop running inside Claude goes here, with captions.</p>
          </Screen>
          <figcaption className="sr-only">Screen capture of Stoop inside Claude, not recorded yet</figcaption>
        </figure>
      </header>

      <Step n={1} id="token" title="Get a token">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="rounded-card border-2 border-ink bg-surface p-5 shadow-float sm:p-7">
            <McpTokenForm />
          </div>
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
            <p className="text-base font-semibold text-ink">The token is shown once, then emailed to you.</p>
            <p>
              Tokens are capped at {PER_TOKEN.calls} tool calls and {PER_TOKEN.cultureBriefs} culture briefs a day, work until {expiryText(EXPIRES)}, and can be
              revoked.
            </p>
            <p>score_brief uses Qloo only, no AI model. culture_brief starts a run with the same limits as the website, or sends back an example report when live runs are off.</p>
          </div>
        </div>
      </Step>

      <Step n={2} id="setup" title="Add Stoop to Claude">
        <SetupSnippets fallbackOrigin={ORIGIN} />
      </Step>

      <Step n={3} id="session" title="Ask Claude">
        <ExampleSession fallbackOrigin={ORIGIN} />
      </Step>
    </main>
  );
}

function Step({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mx-auto flex max-w-6xl scroll-mt-24 flex-col gap-6 px-5 pb-16">
      <div className="flex items-center gap-4 border-t-2 border-ink pt-6">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-base text-paper">
          {n}
        </span>
        <h2 id={`${id}-title`} className="font-display text-[2rem] leading-[1.02] font-extrabold tracking-tight text-balance [font-stretch:82%] sm:text-[2.5rem]">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
