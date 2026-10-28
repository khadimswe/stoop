// The floor's building blocks: a quiet work tool for the sales floor, so the neon poster is the only
// loud thing on screen. Warm grey page, black ink, white surfaces, one lime signal from the poster.
// Server-safe and presentational; interactive pieces live next to this file.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";

/** The 5 steps of the flow, in order. */
export const STEPS = ["Block", "Create", "Event", "Poster", "Promote"] as const;
export type Step = (typeof STEPS)[number];

export const PRIMARY =
  "inline-flex h-13 w-full items-center justify-center gap-2 rounded-[12px] bg-fl-ink px-5 text-base font-semibold text-white outline-offset-2 hover:bg-[#2a2a2e] disabled:opacity-60 [&_svg]:size-5";
export const BUTTON2 =
  "inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-fl-line bg-white px-4 text-[0.9375rem] font-semibold text-fl-ink hover:bg-fl-sunk disabled:opacity-60 [&_svg]:size-4";
export const BUTTON2_SM =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[12px] border border-fl-line bg-white px-3 text-sm font-semibold text-fl-ink hover:bg-fl-sunk disabled:opacity-60 [&_svg]:size-4";
export const TEXT_LINK = "font-medium text-fl-ink underline decoration-1 underline-offset-[3px] hover:decoration-2";

/** Stoop's mark: an ink tile with the stoop's steps in lime. */
export function FloorMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="28" height="28" rx="8" fill="var(--color-fl-ink)" />
      <path d="M8 19.5h12M9.5 15.5h9M11 11.5h6M12.5 7.5h3" stroke="var(--color-fl-signal)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The app bar: 52 px, an icon slot, the centered title (with an optional line under it), an icon slot. */
export function AppBar({ left, title, subtitle, right }: { left?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-fl-page/95 backdrop-blur">
      <div className="mx-auto grid h-13 max-w-xl grid-cols-[44px_minmax(0,1fr)_44px] items-center px-2">
        <div className="flex justify-start">{left}</div>
        <div className="min-w-0 text-center leading-tight">
          <p className="truncate text-[0.9375rem] font-semibold">{title}</p>
          {subtitle && <p className="truncate text-[0.8125rem] text-fl-dim">{subtitle}</p>}
        </div>
        <div className="flex justify-end">{right}</div>
      </div>
    </header>
  );
}

/** A 44 px icon button or link for the app bar. */
export function IconSlot({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} aria-label={label} className="flex size-11 items-center justify-center rounded-[12px] hover:bg-fl-band [&_svg]:size-5">
      {children}
    </Link>
  );
}

/**
 * The stepper: Block, Create, Event, Poster, Promote. Done steps are links (ink bar), the current one
 * is bold with a thicker bar, later ones are dim. `hrefs` maps a done step to where it goes.
 */
export function Stepper({ current, hrefs = {} }: { current: Step; hrefs?: Partial<Record<Step, string>> }) {
  const at = STEPS.indexOf(current);
  return (
    <nav aria-label="Steps" className="mx-auto max-w-xl px-4">
      <ol className="grid grid-cols-5 gap-1">
        {STEPS.map((step, i) => {
          const state = i < at ? "done" : i === at ? "now" : "next";
          const label = (
            <span
              className={cn(
                "block truncate border-t-2 pt-2 text-xs leading-4",
                state === "done" && "border-fl-ink text-fl-ink",
                state === "now" && "border-t-[3px] pt-[7px] font-bold text-fl-ink",
                state === "next" && "border-fl-future text-fl-dim",
              )}
            >
              {step}
            </span>
          );
          return (
            <li key={step} aria-current={state === "now" ? "step" : undefined}>
              {state === "done" && hrefs[step] ? (
                <Link href={hrefs[step]!} className="block min-h-11 hover:[&>span]:underline">
                  {label}
                </Link>
              ) : (
                <span className="block min-h-11">{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A screen's serif title and one meta line. */
export function ScreenTitle({ title, meta, eyebrow, as: Tag = "h1" }: { title: ReactNode; meta?: ReactNode; eyebrow?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <div className="flex flex-col gap-1.5">
      {eyebrow && <p className="text-sm text-fl-dim tabular-nums">{eyebrow}</p>}
      <Tag className="font-serif text-[2rem] leading-[1.1] font-normal tracking-[-0.01em] text-balance">{title}</Tag>
      {meta && <p className="text-sm text-fl-dim">{meta}</p>}
    </div>
  );
}

/** A section with a 17 px heading and something on the right (a count, a link, a tag). */
export function Section({ id, title, aside, children, className }: { id?: string; title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn("flex scroll-mt-28 flex-col gap-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id ? `${id}-h` : undefined} className="text-[1.0625rem] leading-[22px] font-semibold">
          {title}
        </h2>
        {aside && <div className="flex shrink-0 items-baseline gap-2 text-[0.8125rem] text-fl-dim">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A white, radius-20 list with hairlines between rows. */
export function RowGroup({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule", className)}>
      {children}
    </ul>
  );
}

/** One row: a lead (badge or label column), the main text, and a trailing value or chevron. */
export function Row({ id, lead, title, sub, trail, className }: { id?: string; lead?: ReactNode; title: ReactNode; sub?: ReactNode; trail?: ReactNode; className?: string }) {
  return (
    <li id={id} className={cn("flex min-h-[54px] items-center gap-3 px-4 py-3", className)}>
      {lead}
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] leading-5 font-medium text-pretty">{title}</div>
        {sub && <div className="mt-px text-[0.8125rem] leading-[18px] text-fl-dim">{sub}</div>}
      </div>
      {trail}
    </li>
  );
}

/** The 64 px label column a form row starts with. */
export function RowLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? "label" : "span";
  return (
    <Tag htmlFor={htmlFor} className="w-16 shrink-0 text-[0.8125rem] leading-[18px] text-fl-dim">
      {children}
    </Tag>
  );
}

export function Chevron() {
  return <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fl-chev" />;
}

/** A 24 px ink ring with a number; filled when the plan uses that place. */
export function NumBadge({ n, on = false, dashed = false, label }: { n?: number | string; on?: boolean; dashed?: boolean; label?: string }) {
  return (
    <span
      aria-label={label}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-fl-ink text-[0.6875rem] leading-none font-semibold tabular-nums",
        on && "bg-fl-ink text-white",
        dashed && "border-dashed",
      )}
    >
      {n}
    </span>
  );
}

/** A small status pill: Posted (green), Poster ready (ink), Planned (grey). */
export function StatusPill({ tone, children }: { tone: "ok" | "ready" | "draft"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-[6px] px-2 text-xs leading-none font-semibold whitespace-nowrap",
        tone === "ok" && "bg-fl-ok-bg text-fl-ok",
        tone === "ready" && "bg-fl-ink text-white",
        tone === "draft" && "bg-fl-band text-fl-muted",
      )}
    >
      {children}
    </span>
  );
}

/** Three numbers in a white strip: big value, small label under it. */
export function StatStrip({ stats, label }: { stats: readonly { value: ReactNode; label: ReactNode }[]; label?: string }) {
  return (
    <dl aria-label={label} className="grid overflow-hidden rounded-[20px] bg-white" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
      {stats.map((s, i) => (
        <div key={i} className={cn("flex flex-col-reverse px-4 py-3.5", i > 0 && "border-l border-fl-rule")}>
          <dt className="text-[0.8125rem] leading-[18px] text-fl-dim">{s.label}</dt>
          <dd className="text-[1.375rem] leading-[26px] font-medium tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small print: the fictional-store line, notes under a list. */
export function Fine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-4 text-fl-dim", className)}>{children}</p>;
}

/** The sticky bottom bar with the screen's one primary action. */
export function ActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 mt-auto border-t border-fl-rule bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        {note && <p className="text-center text-xs text-fl-dim">{note}</p>}
        {children}
      </div>
    </div>
  );
}

/** The page body under the bar and stepper: one centered column at phone width. */
export function ScreenBody({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-4 pt-5 pb-8", className)}>{children}</main>;
}

/** A calm notice in the page: what happened and what to do. */
export function Notice({ title, children, tone = "plain" }: { title: ReactNode; children?: ReactNode; tone?: "plain" | "bad" }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex flex-col gap-1 rounded-[20px] bg-white px-4 py-3.5", tone === "bad" && "border border-fl-bad")}>
      <p className={cn("text-[0.9375rem] font-semibold", tone === "bad" && "text-fl-bad")}>{title}</p>
      {children && <div className="text-sm text-fl-muted">{children}</div>}
    </div>
  );
}
