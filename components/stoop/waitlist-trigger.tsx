"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { WaitlistForm, type WaitlistSignup } from "./waitlist-form";

const TITLE = "Get a free Culture Brief";
const BLURB = "Join the beta. We'll map the audience around your product, with the Qloo data behind it.";

/**
 * Opens the waitlist in place: a popover on desktop, a bottom sheet on phones. Never a separate page,
 * never an automatic popup.
 */
export function WaitlistTrigger({
  label = "Get a free brief",
  variant = "default",
  size = "sm",
  onSubmit,
}: {
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  onSubmit?: (signup: WaitlistSignup) => Promise<{ position: number }>;
}) {
  const desktop = useMediaQuery("(min-width: 640px)", true);
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
          <WaitlistForm onSubmit={onSubmit} />
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
        <WaitlistForm onSubmit={onSubmit} />
      </SheetContent>
    </Sheet>
  );
}
