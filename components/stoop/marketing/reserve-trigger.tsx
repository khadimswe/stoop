"use client";

import { useEffect, useRef, useState } from "react";
import { WaitlistForm, type WaitlistSignup } from "@/components/stoop/waitlist-form";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { WaitlistRequest } from "@/lib/api/requests";
import { popoverShift } from "@/lib/marketing/popover-fit";
import { postWaitlist, sourceFromPath } from "@/lib/waitlist-client";

type Plan = NonNullable<WaitlistRequest["plan"]>;

const SIDE_OFFSET = 10;
const COLLISION_PADDING = 12;
/** How long after opening the popover is refitted on every frame, while it mounts and lays out. */
const SETTLE_MS = 500;

function request(signup: WaitlistSignup, plan: Plan, productLink?: string): WaitlistRequest {
  return {
    email: signup.email,
    sellsOn: signup.sellsOn,
    consent: signup.consent,
    company: signup.company,
    plan,
    sourceReport: sourceFromPath(window.location.pathname),
    productLink,
  };
}

/**
 * A pricing card's "Reserve": the waitlist, tagged with the plan, with "Reserve" on its button. A
 * popover on desktop, a bottom sheet on phones, as for every waitlist entry point. The pricing cards
 * sit mid-page, where neither side of the button has room for the whole form, so on opening the page
 * scrolls just enough for the popover to open above the button with its submit on screen (on a very
 * short window it scrolls inside instead of running off the screen).
 */
export function ReserveTrigger({ plan, planName }: { plan: Plan; planName: string }) {
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const title = `Reserve ${planName}`;
  const blurb = "Join the beta waitlist. Plans start after beta, and nothing is charged now.";

  useEffect(() => {
    if (!open || !desktop) return;
    const fit = () => {
      const trigger = triggerRef.current;
      const content = contentRef.current;
      if (!trigger || !content) return;
      const { top, bottom } = trigger.getBoundingClientRect();
      // Its whole height: the content (scrollHeight, uncut by max-height), its border, and a pixel for rounding.
      const height = content.scrollHeight + (content.offsetHeight - content.clientHeight) + 1;
      const shift = popoverShift({ top, bottom, viewport: window.innerHeight, height, offset: SIDE_OFFSET, padding: COLLISION_PADDING });
      // The popover follows its trigger as the page scrolls, and takes the room above it.
      if (shift > 0) window.scrollBy({ top: -shift, behavior: "instant" });
    };
    // The popover mounts and lays out over a few frames, so it is fitted on every frame for the first
    // half second; from then on, whenever its parts change size (the error line, the success screen).
    let frame = 0;
    let observer: ResizeObserver | null = null;
    const started = performance.now();
    const settle = () => {
      fit();
      const content = contentRef.current;
      if (content && !observer) {
        observer = new ResizeObserver(fit);
        for (const child of content.children) observer.observe(child);
      }
      if (performance.now() - started < SETTLE_MS) frame = requestAnimationFrame(settle);
    };
    frame = requestAnimationFrame(settle);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [open, desktop]);

  const form = (
    <WaitlistForm
      submitLabel="Reserve"
      onSubmit={(signup) => postWaitlist(request(signup, plan))}
      onProductLink={async (url, signup) => {
        await postWaitlist(request(signup, plan, url));
      }}
    />
  );
  const trigger = (
    <Button ref={triggerRef} variant="outline" aria-label={`Reserve ${planName}`}>
      Reserve
    </Button>
  );

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          ref={contentRef}
          side="top"
          align="start"
          sideOffset={SIDE_OFFSET}
          collisionPadding={COLLISION_PADDING}
          // Focus the email field without the browser scrolling to it: the page scroll is the fit above's alone.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.querySelector<HTMLElement>("input:not([tabindex='-1']), button")?.focus({ preventScroll: true });
          }}
          className="max-h-(--radix-popover-content-available-height) w-96 gap-1 overflow-y-auto rounded-2xl border border-hairline bg-surface p-5 shadow-l2 ring-0"
        >
          <p className="font-display text-xl font-extrabold [font-stretch:85%]">{title}</p>
          <p className="mb-2 text-sm text-ink-soft">{blurb}</p>
          {form}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-hairline bg-surface px-5 pb-8">
        <SheetHeader className="px-0">
          <SheetTitle className="font-display text-xl font-extrabold [font-stretch:85%]">{title}</SheetTitle>
          <SheetDescription className="text-ink-soft">{blurb}</SheetDescription>
        </SheetHeader>
        {form}
      </SheetContent>
    </Sheet>
  );
}
