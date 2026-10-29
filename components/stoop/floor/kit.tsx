// The floor's building blocks: a quiet work tool for the sales floor, so the neon poster is the only
// loud thing on screen. Warm grey page, black ink, white surfaces, one lime signal from the poster.
// Server-safe and presentational; interactive pieces live next to this file.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";

/** The 5 steps of the flow, in order. */
export const STEPS = ["Community", "Create", "Event", "Poster", "Promote"] as const;
export type Step = (typeof STEPS)[number];

export const PRIMARY =
  "inline-flex h-13 w-full items-center justify-center gap-2 rounded-[12px] bg-fl-ink px-5 text-base font-semibold text-white outline-offset-2 hover:bg-[#2a2a2e] disabled:opacity-60 [&_svg]:size-5";
/** The primary at its own width (the landing hero, the judges' guide). */
export const PRIMARY_INLINE =
  "inline-flex h-13 items-center justify-center gap-2 rounded-[12px] bg-fl-ink px-6 text-base font-semibold text-white outline-offset-2 hover:bg-[#2a2a2e]";
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
export function AppBar({ left, title, subtitle, right, className }: { left?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-30 bg-fl-page/95 backdrop-blur", className)}>
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

/**
 * The floor's header, phone and desktop. Below 1024 px: the 52 px app bar (back, title, My stores)
 * with the stepper under it. From 1024 px: one 56 px white bar across the top, the store and its city
 * on the left, the stepper centered as numbered tabs, "My stores" on the right.
 */
export function FloorHeader({
  title,
  subtitle,
  left,
  right,
  store,
  step,
  hrefs,
  reasons,
  storesHref = "/stores",
}: {
  /** The phone bar's centered title. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** The phone bar's icon slots. */
  left?: ReactNode;
  right?: ReactNode;
  /** The desktop bar's left side; without it the phone title is used. */
  store?: { name: string; city?: string | null } | null;
  step?: Step;
  hrefs?: Partial<Record<Step, string>>;
  /** Why a step can't be opened from here, said on the step itself. */
  reasons?: Partial<Record<Step, string>>;
  storesHref?: string;
}) {
  const side = store ? store.city : subtitle;
  return (
    <>
      <AppBar className="lg:hidden" left={left} title={title} subtitle={subtitle} right={right} />
      {step && <Stepper className="lg:hidden" current={step} hrefs={hrefs} reasons={reasons} />}
      <header className="sticky top-0 z-30 hidden h-14 border-b border-fl-rule bg-white lg:block">
        <div className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3 justify-self-start rounded-[8px] outline-offset-4">
            <FloorMark className="size-7 shrink-0" />
            <span className="sr-only">Stoop home: </span>
            <span className="truncate text-[0.9375rem] font-semibold">{store?.name ?? title}</span>
            {side && <span className="truncate text-[0.9375rem] text-fl-dim">{side}</span>}
          </Link>
          {step ? <Stepper variant="bar" current={step} hrefs={hrefs} reasons={reasons} /> : <span />}
          <div className="flex justify-end">
            <Link href={storesHref} className="rounded-[8px] px-2 py-1.5 text-sm font-medium text-fl-muted hover:text-fl-ink hover:underline">
              My stores
            </Link>
          </div>
        </div>
      </header>
    </>
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
 * The stepper: Community, Create, Event, Poster, Promote. A step with an href is a link (an example
 * store links all five; a live plan links the ones that exist), the current one is bold with a 3 px
 * ink bar, done ones keep an ink bar, later ones are dim. `reasons` says why a step without a link
 * can't be opened. On a phone it is five columns under the app bar with room between the labels (the
 * first never shrinks below "Community"); in the desktop bar (`variant="bar"`) the steps are tabs.
 */
export function Stepper({
  current,
  hrefs = {},
  reasons = {},
  variant = "phone",
  className,
}: {
  current: Step;
  hrefs?: Partial<Record<Step, string>>;
  reasons?: Partial<Record<Step, string>>;
  variant?: "phone" | "bar";
  className?: string;
}) {
  const at = STEPS.indexOf(current);
  const bar = variant === "bar";
  return (
    <nav aria-label="Steps" className={cn(bar ? "h-full" : "mx-auto max-w-xl px-4", className)}>
      <ol className={bar ? "flex h-full items-stretch gap-2" : "grid grid-cols-[minmax(max-content,1.15fr)_repeat(4,minmax(0,1fr))] gap-2.5"}>
        {STEPS.map((step, i) => {
          const state = i < at ? "done" : i === at ? "now" : "next";
          const href = state === "now" ? undefined : hrefs[step];
          const reason = href ? undefined : reasons[step];
          const label = (
            <span
              className={cn(
                bar ? "flex h-full items-center border-t-2 px-3 text-sm leading-5 whitespace-nowrap" : "block truncate border-t-2 pt-2 text-xs leading-4",
                state === "done" && "border-fl-ink text-fl-ink",
                state === "now" && (bar ? "border-t-[3px] border-fl-ink font-bold text-fl-ink" : "border-t-[3px] border-fl-ink pt-[7px] font-bold text-fl-ink"),
                state === "next" && (href ? "border-fl-future text-fl-muted" : "border-fl-future text-fl-dim"),
              )}
            >
              {bar && <span className="mr-1.5 tabular-nums">{i + 1}</span>}
              {step}
              {reason && <span className="sr-only">: {reason}</span>}
            </span>
          );
          return (
            <li key={step} aria-current={state === "now" ? "step" : undefined} className={bar ? "flex" : undefined}>
              {href ? (
                <Link href={href} className={cn("hover:[&>span]:underline", bar ? "flex h-full" : "block min-h-11")}>
                  {label}
                </Link>
              ) : (
                <span title={reason} className={cn(bar ? "flex h-full" : "block min-h-11", reason && "cursor-not-allowed")}>
                  {label}
                </span>
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
        <div key={i} className={cn("flex flex-col-reverse justify-end px-3 py-3.5 sm:px-4", i > 0 && "border-l border-fl-rule")}>
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

/** The sticky bottom bar with the screen's one primary action. A desktop layout passes `lg:hidden` and puts its primary in the page. */
export function ActionBar({ children, note, className }: { children: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div role="region" aria-label="Next step" className={cn("sticky bottom-0 z-20 mt-auto border-t border-fl-rule bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        {note && <p className="text-center text-xs text-fl-dim">{note}</p>}
        {children}
      </div>
    </div>
  );
}

/** The page body under the bar and stepper: one centered column at phone width. */
export function ScreenBody({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn("mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-4 pt-5 pb-8 lg:pt-8", className)}>{children}</main>;
}

/**
 * A desktop page in two columns (from 1024 px): the content, and a 380 px side column that stays in
 * view. Within 1200 px with 24 px gutters. Below 1024 px it is the phone column, the side column last.
 */
export function TwoColumn({ main, side, sideOnPhone = false, className }: { main: ReactNode; side: ReactNode; sideOnPhone?: boolean; className?: string }) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-4 pt-5 pb-8 lg:grid lg:max-w-[1200px] lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-12 lg:px-6 lg:pt-8 lg:pb-16",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-7">{main}</div>
      <aside className={cn("flex-col gap-4 lg:sticky lg:top-[80px] lg:flex", sideOnPhone ? "flex" : "hidden")}>{side}</aside>
    </main>
  );
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
