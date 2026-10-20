"use client";

import { WaitlistForm, type WaitlistSignup } from "@/components/stoop/waitlist-form";
import type { WaitlistRequest } from "@/lib/api/requests";
import { postWaitlist, sourceFromPath } from "@/lib/waitlist-client";

function request(signup: WaitlistSignup, productLink?: string): WaitlistRequest {
  return {
    email: signup.email,
    sellsOn: signup.sellsOn,
    consent: signup.consent,
    company: signup.company,
    sourceReport: sourceFromPath(window.location.pathname),
    productLink,
  };
}

/** The waitlist form inline on the page (the pricing section), posting to /api/waitlist like the nav pill does. */
export function InlineWaitlist({ className }: { className?: string }) {
  return (
    <WaitlistForm
      className={className}
      onSubmit={(signup) => postWaitlist(request(signup))}
      onProductLink={async (url, signup) => {
        await postWaitlist(request(signup, url));
      }}
    />
  );
}
