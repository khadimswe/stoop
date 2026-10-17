"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { WaitlistRequest } from "@/lib/api/requests";
import { postWaitlist, sourceFromPath } from "@/lib/waitlist-client";
import { WaitlistForm, type WaitlistSignup } from "./waitlist-form";

const TITLE = "Get a free Culture Brief";
const BLURB = "Join the beta. We'll map the audience around your product, with the Qloo data behind it.";

/** The signup as /api/waitlist takes it, tagged with the page it came from and the plan, if any. */
function request(signup: WaitlistSignup, extra: { plan?: WaitlistRequest["plan"]; source?: string; productLink?: string }): WaitlistRequest {
  return {
    email: signup.email,
    sellsOn: signup.sellsOn,
    consent: signup.consent,
    company: signup.company,
    plan: extra.plan,
    sourceReport: extra.source ?? sourceFromPath(window.location.pathname),
    productLink: extra.productLink,
  };
}

/**
 * Opens the waitlist in place: a popover on desktop, a bottom sheet on phones. Never a separate page,
 * never an automatic popup. Signups go to /api/waitlist; the success screen's product link posts the
 * same signup again, so it lands on the same entry. `plan` is set by a pricing card's "Reserve".
 */
export function WaitlistTrigger({
  label = "Get a free brief",
  variant = "default",
  size = "sm",
  plan,
  source,
  onSubmit: submitOverride,
}: {
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  plan?: WaitlistRequest["plan"];
  /** Where the signup came from (an example slug, a run id); defaults to the current page. */
  source?: string;
  onSubmit?: (signup: WaitlistSignup) => Promise<{ position: number }>;
}) {
  const desktop = useMediaQuery("(min-width: 640px)", true);
  const onSubmit = submitOverride ?? ((signup: WaitlistSignup) => postWaitlist(request(signup, { plan, source })));
  const onProductLink = async (url: string, signup: WaitlistSignup) => {
    await postWaitlist(request(signup, { plan, source, productLink: url }));
  };
  const trigger = (
    <Button variant={variant} size={size}>
      {label}
    </Button>
  );

  if (desktop) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="end" sideOffset={10} className="w-96 gap-1 rounded-2xl border border-hairline bg-surface p-5 shadow-l2 ring-0">
          <p className="font-display text-xl font-extrabold [font-stretch:85%]">{TITLE}</p>
          <p className="mb-2 text-sm text-ink-soft">{BLURB}</p>
          <WaitlistForm onSubmit={onSubmit} onProductLink={onProductLink} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl border-t border-hairline bg-surface px-5 pb-8">
        <SheetHeader className="px-0">
          <SheetTitle className="font-display text-xl font-extrabold [font-stretch:85%]">{TITLE}</SheetTitle>
          <SheetDescription className="text-ink-soft">{BLURB}</SheetDescription>
        </SheetHeader>
        <WaitlistForm onSubmit={onSubmit} onProductLink={onProductLink} />
      </SheetContent>
    </Sheet>
  );
}
