import type { ReactNode } from "react";
import { cn } from "cn";

// Small pieces the demo's beats share. No hooks: they render the same on the server and in the player.

/** The stage's fixed shape: a tall card on phones, 4:3 on tablets, 16:9 on desktops (no layout shift). */
export const STAGE_BOX = "relative aspect-[9/16] w-full overflow-hidden @xl:aspect-[4/3] @4xl:aspect-[16/9]";
/** The control bar's fixed height. */
export const BAR_BOX = "flex h-[4.25rem] items-center gap-2 border-t border-paper/10 px-3 @md:gap-3 @2xl:px-5";

/** A mono label above a beat or a panel. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-[0.6875rem] leading-4 font-medium tracking-[0.08em] text-paper-dim uppercase", className)}>{children}</p>;
}

/** A beat's title: Bricolage, narrow, sized to the screen (never over 32px). */
export function BeatTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-display text-[1.375rem]/[1.1] font-extrabold tracking-tight text-balance [font-stretch:85%] @2xl:text-[1.75rem]/[1.1] @4xl:text-[2rem]/[1.1]", className)}>{children}</p>;
}

/** A raised panel inside the screen. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-paper/10 bg-screen-raised", className)}>{children}</div>;
}

/** The text cursor while a field is being typed into. Still under reduced motion. */
export function Caret({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return <span className="ml-px inline-block h-[1.1em] w-0.5 translate-y-[0.18em] rounded-full bg-paper motion-safe:animate-caret" />;
}

/** A button on the replayed screen: it looks pressed for a moment when the replay presses it. Not interactive. */
export function ReplayButton({ children, pressed, className }: { children: ReactNode; pressed: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border-2 border-ink bg-brick px-5 text-[0.9rem] font-semibold text-ink shadow-pop transition-[transform,box-shadow,filter] duration-150",
        pressed && "translate-y-px scale-[0.97] shadow-none brightness-90",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A label chip in the screen's colors: who a line or a card speaks for. */
export function SourceTag({ tone, children, className }: { tone: "qloo" | "you" | "concrete"; children: ReactNode; className?: string }) {
  const style = {
    qloo: "border-dusk-light bg-dusk-light text-screen",
    you: "border-paper text-paper",
    concrete: "border-dashed border-concrete-screen text-concrete-screen",
  }[tone];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full border-[1.5px] px-2.5 py-0.5 text-[0.75rem] leading-4 font-semibold whitespace-nowrap", style, className)}>{children}</span>;
}

/** Rises into place when it mounts (the beat's own motion; off under reduced motion). */
export const RISE = "motion-safe:animate-rise";
