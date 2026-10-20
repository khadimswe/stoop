"use client";

import { WaitlistForm, type WaitlistSignup } from "@/components/stoop/waitlist-form";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { WaitlistRequest } from "@/lib/api/requests";
import { postWaitlist, sourceFromPath } from "@/lib/waitlist-client";

type Plan = NonNullable<WaitlistRequest["plan"]>;

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
 * A pricing card's "Reserve": the waitlist, tagged with the plan. A popover on desktop, a bottom sheet
 * on phones, as for every waitlist entry point. The pricing cards sit mid-page, so the popover keeps
 * to the space the viewport has and scrolls inside instead of running off the screen.
 */
export function ReserveTrigger({ plan, planName }: { plan: Plan; planName: string }) {
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const title = `Reserve ${planName}`;
  const blurb = "Join the beta waitlist. Plans start after beta, and nothing is charged now.";
  const form = (
    <WaitlistForm
      onSubmit={(signup) => postWaitlist(request(signup, plan))}
      onProductLink={async (url, signup) => {
        await postWaitlist(request(signup, plan, url));
      }}
    />
  );
  const trigger = (
    <Button variant="outline" aria-label={`Reserve ${planName}`}>
      Reserve
    </Button>
  );

  if (desktop) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
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
