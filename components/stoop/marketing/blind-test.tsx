"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Screen } from "@/components/stoop/screen";
import { VideoTile } from "@/components/stoop/video-tile";
import { WaitlistTrigger } from "@/components/stoop/waitlist-trigger";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface BlindClip {
  src: string;
  poster: string | null;
  captions: string | null;
}

type Choice = "culture" | "control";
type Pick = Choice | "skip";

interface Tally {
  n: number;
  culture: number;
}

// The order is drawn once per page load in the browser. The server and the first client render use
// a fixed order, then React re-renders with the drawn one, so hydration never mismatches.
const drawnFlip = typeof window === "undefined" ? false : Math.random() < 0.5;
const noSubscription = () => () => {};

function readTally(value: unknown): Tally | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.n === "number" && typeof v.culture === "number" ? { n: v.n, culture: v.culture } : null;
}

/** Real votes only: n is always shown, and "Early results" stays on until 30 votes. */
function tallyText(tally: Tally): string {
  const votes = `${tally.n} ${tally.n === 1 ? "vote" : "votes"}`;
  if (tally.n < 30) return `Early results · ${votes}`;
  return `${tally.culture} of ${votes} picked the culture-made ad`;
}

const MESSAGE: Record<Pick, string> = {
  culture: "You picked the Qloo-grounded ad.",
  control: "Most AI ads look like this one. Here's what Qloo changed.",
  skip: "",
};

/**
 * The landing blind test, shown only when the lead example's two hook clips are approved
 * (lib/demo/hero.ts). Two unlabeled clips in a random order; pick one with a tap, or 1 and 2 while the
 * stage has focus. The reveal chains into the three demo beats: the example's Reality Check card
 * (`reveal`, rendered on the server), then "See why it works" into its Screening Room.
 */
export function BlindTest({
  example,
  culture,
  control,
  cultureLabel,
  reveal,
  screeningHref = "#screening",
}: {
  example: string;
  culture: BlindClip;
  control: BlindClip;
  /** The concept world the culture clip was made for, shown after the reveal. */
  cultureLabel: string;
  reveal: ReactNode;
  screeningHref?: string;
}) {
  const flipped = useSyncExternalStore(noSubscription, () => drawnFlip, () => false);
  const order: Choice[] = flipped ? ["control", "culture"] : ["culture", "control"];
  const [pick, setPick] = useState<Pick | null>(null);
  const [sound, setSound] = useState<Choice | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  // Hook cuts start after the page has loaded, so they never compete with the hero H1 (the LCP).
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (document.readyState === "complete") {
      const id = window.setTimeout(() => setLoaded(true), 0);
      return () => window.clearTimeout(id);
    }
    const onLoad = () => setLoaded(true);
    window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);

  async function choose(next: Pick) {
    setPick(next);
    try {
      const response =
        next === "skip"
          ? await fetch(`/api/vote?example=${encodeURIComponent(example)}`)
          : await fetch("/api/vote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example, choice: next }) });
      setTally(readTally(await response.json().catch(() => null)));
    } catch {
      setTally(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (pick || event.target !== event.currentTarget) return;
    if (event.key === "1" || event.key === "2") {
      event.preventDefault();
      void choose(order[event.key === "1" ? 0 : 1]);
    }
  }

  const clips = { culture, control };
  const revealed = pick !== null;
  const letter = (i: number) => (i === 0 ? "A" : "B");

  return (
    <Screen
      role="group"
      aria-label="Blind test: which ad would you stop scrolling for?"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-col gap-5 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-display text-2xl leading-tight font-extrabold [font-stretch:85%]">Which would you stop scrolling for?</p>
        {!revealed && (
          <Button variant="link" size="sm" className="h-11 text-paper-dim" onClick={() => void choose("skip")}>
            Skip, just show me
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {order.map((choice, i) => {
          const label = revealed ? (choice === "culture" ? `Culture-made · ${cultureLabel}` : "Control · generic") : letter(i);
          return (
            <div key={choice} className="flex min-w-0 flex-col gap-2.5">
              <VideoTile
                label={label}
                tone={revealed ? choice : "neutral"}
                src={clips[choice].src}
                poster={clips[choice].poster ?? undefined}
                captions={clips[choice].captions ?? undefined}
                autoPlay={loaded}
                muted={sound !== choice}
                onToggleSound={() => setSound((current) => (current === choice ? null : choice))}
              />
              {!revealed && (
                <Button variant="screen" className="h-11 border-paper text-paper" onClick={() => void choose(choice)}>
                  Pick {letter(i)}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {!revealed ? (
        <p className="text-sm text-paper-dim">Pick A or B, or press 1 or 2 while this screen is focused. One clip has sound at a time.</p>
      ) : (
        <div className={cn("flex flex-col gap-4 border-t border-paper/15 pt-4", "motion-safe:animate-rise")} role="status">
          <p className="font-display text-[1.4rem] leading-tight font-extrabold [font-stretch:85%]">
            {pick === "skip" ? `${letter(order.indexOf("culture"))} is culture-made. ${letter(order.indexOf("control"))} is the generic Control.` : MESSAGE[pick]}
          </p>
          {/* The card is a paper object inside the screen: its focus ring goes back to dusk. */}
          <div className="text-ink [--ring:var(--color-dusk)]">{reveal}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button asChild variant="screen" className="h-11 border-paper bg-paper text-ink hover:bg-paper/90">
              <Link href={screeningHref}>
                See why it works
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
            <Button variant="link" size="sm" className="h-11 text-paper-dim" onClick={() => setPick(null)}>
              Watch again
            </Button>
            {tally && <span className="font-mono text-xs text-paper-dim">{tallyText(tally)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-paper">
            Want this for your product?
            <WaitlistTrigger label="Get a free brief" variant="link" size="sm" />
          </div>
        </div>
      )}
    </Screen>
  );
}
