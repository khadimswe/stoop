import { Check, Globe } from "lucide-react";
import type { ReactNode } from "react";
import type { AgeSkewMiniView } from "@/lib/marketing/landing";
import { cn } from "cn";
import { reveal, REVEAL_CLASS } from "./reveal";
import { SectionIntro } from "./section-intro";

/** A small dark screen inside a step card: an illustration, so it carries no sticker shadow. */
function MiniScreen({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div
      data-surface="screen"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("flex aspect-[4/3] w-full flex-col gap-2.5 overflow-hidden rounded-2xl bg-screen p-4 text-paper", className)}
    >
      {children}
    </div>
  );
}

/** Step 1: a product page being read. Placeholder lines only: no brand, no data. */
function ReadSite() {
  return (
    <MiniScreen>
      <div className="flex items-center gap-2 rounded-full bg-screen-raised px-3 py-1.5 font-mono text-[0.6875rem] text-paper-dim">
        <Globe className="size-3.5 shrink-0" />
        <span className="truncate">yourstore.example/products/your-product</span>
      </div>
      <div className="flex flex-1 gap-3">
        <div className="aspect-square w-[38%] shrink-0 rounded-lg bg-screen-raised" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <div className="h-2.5 w-4/5 rounded-full bg-paper/70" />
          <div className="h-2 w-2/5 rounded-full bg-paper/35" />
          <div className="mt-1 h-2 w-full rounded-full bg-paper/20" />
          <div className="h-2 w-11/12 rounded-full bg-paper/20" />
          <div className="h-2 w-3/5 rounded-full bg-paper/20" />
        </div>
      </div>
      <span className="self-start rounded-full border-[1.5px] border-dashed border-concrete-screen px-2.5 py-0.5 text-[0.6875rem] font-semibold text-concrete-screen">
        Read from your site · not from Qloo
      </span>
    </MiniScreen>
  );
}

/** Step 2: the lead example's real age skews from Qloo, the top skew marked. Skews, never shares. */
function SkewChart({ view }: { view: AgeSkewMiniView | null }) {
  if (!view) {
    return (
      <MiniScreen>
        <p className="m-auto text-sm text-paper-dim">No Qloo signal</p>
      </MiniScreen>
    );
  }
  return (
    <MiniScreen label={view.summary}>
      <p className="font-mono text-[0.625rem] tracking-widest text-paper-dim uppercase">{view.brand} · age skews</p>
      <ul className="flex flex-1 flex-col justify-between">
        {view.bars.map((bar) => (
          <li key={bar.label} className="grid grid-cols-[4.75rem_1fr] items-center gap-2 text-[0.6875rem] leading-none">
            <span className={bar.top ? "font-semibold text-paper" : "text-paper-dim"}>{bar.label}</span>
            {/* A centered axis: under-indexing to the left, over-indexing to the right. */}
            <span className="relative h-2.5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-paper/30" />
              <span
                className={cn("absolute inset-y-0 rounded-full", bar.top ? "bg-dusk-light" : "bg-paper/45")}
                style={bar.value >= 0 ? { left: "50%", width: `${bar.value / 2}%` } : { right: "50%", width: `${-bar.value / 2}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <span className="self-start rounded-full bg-dusk-light px-2.5 py-0.5 text-[0.6875rem] font-semibold text-screen">Qloo</span>
    </MiniScreen>
  );
}

/** Step 3: the Control and two concept worlds, side by side, labeled in words. */
function Worlds() {
  return (
    <MiniScreen>
      <div className="grid flex-1 grid-cols-3 gap-2">
        <div className="flex flex-col justify-end rounded-lg border-[1.5px] border-dashed border-concrete-screen p-1.5">
          <span className="text-[0.625rem] leading-tight font-semibold text-concrete-screen">Control</span>
        </div>
        {["World 1", "World 2"].map((world) => (
          <div key={world} className="flex flex-col justify-end rounded-lg border-[1.5px] border-paper/60 bg-screen-raised p-1.5">
            <span className="text-[0.625rem] leading-tight font-semibold text-paper">{world}</span>
          </div>
        ))}
      </div>
      <p className="font-mono text-[0.625rem] text-paper-dim">9:16 · hooks · scripts · scene prompts</p>
    </MiniScreen>
  );
}

/** Step 4: what every pack ends with before anything goes live. */
function Checklist() {
  return (
    <MiniScreen>
      <p className="font-mono text-[0.625rem] tracking-widest text-paper-dim uppercase">Before you launch</p>
      <ul className="flex flex-1 flex-col justify-center gap-2">
        {["Human review checklist", "AI disclosure note", "Export to your video tool"].map((item) => (
          <li key={item} className="flex items-center gap-2 text-xs text-paper">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-paper text-screen">
              <Check className="size-2.5" strokeWidth={3.5} />
            </span>
            {item}
          </li>
        ))}
      </ul>
      <p className="text-[0.6875rem] text-paper-dim">Nothing auto-publishes.</p>
    </MiniScreen>
  );
}

/** "How it works": four numbered cards on the one sand field. They rise in once, one after another. */
export function HowItWorks({ skews }: { skews: AgeSkewMiniView | null }) {
  const steps = [
    {
      title: "Read your site",
      line: "Paste a store or product link. Stoop reads the product, the price and who the page speaks to. No site? Describe it.",
      art: <ReadSite />,
    },
    {
      title: "Qloo measures the audience",
      line: "Qloo maps your product's taste neighborhood: who it is, what else they love, where they cluster. Then it splits it into concept worlds.",
      art: <SkewChart view={skews} />,
    },
    {
      title: "Make the ads",
      line: "Each world gets a Culture Brief and a Production Pack: hooks, scripts and scene prompts for Higgsfield, Veo, Kling or Runway.",
      art: <Worlds />,
    },
    {
      title: "Launch the test",
      line: "Render in your own video tool and run the worlds side by side on Meta and TikTok, next to the generic Control.",
      art: <Checklist />,
    },
  ];
  return (
    <section id="how" aria-labelledby="how-title" className="mx-3 scroll-mt-24 rounded-section bg-sand py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5">
        <div {...reveal()} className={REVEAL_CLASS}>
          <SectionIntro
            id="how-title"
            kicker="How it works"
            title="From your link to the test, in four steps."
            lead="Qloo maps the audience around your product's taste neighborhood: who it is, what else they love, where they cluster."
          />
        </div>
        <ol className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step, i) => (
            <li
              key={step.title}
              {...reveal(i * 110)}
              className={cn("flex min-w-0 flex-col gap-4 rounded-card border-2 border-ink bg-paper-raised p-5 shadow-float", REVEAL_CLASS)}
            >
              <span aria-hidden="true" className="font-display text-[3.5rem] leading-[0.8] font-extrabold tracking-tight [font-stretch:75%]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="type-h3 text-balance">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="text-[0.9375rem] leading-snug text-pretty text-ink-soft">{step.line}</p>
              <div className="mt-auto pt-1">{step.art}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
