"use client";

import { Check } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { postWaitlist } from "@/lib/waitlist-client";
import { cn } from "cn";

type State = { kind: "idle" | "sending" | "error" } | { kind: "done"; position: number };

/**
 * The pilot card's "Reserve": the waitlist, opened in place under the card (a disclosure, so it opens
 * without JavaScript too, and never pops up on its own). Email and consent only; the signup is tagged
 * "store-pilot" so it reads apart from the ad product's waitlist. A hidden honeypot catches bots.
 */
export function ReserveStores({ title, line }: { title: string; line: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const company = new FormData(event.currentTarget).get("stoop_hp")?.toString() || undefined;
    setState({ kind: "sending" });
    try {
      const { position } = await postWaitlist({ email, sellsOn: null, consent, company, sourceReport: "store-pilot" });
      setState({ kind: "done", position });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <details className="group/r rounded-[20px] bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold">{title}</span>
          <span className="block text-[0.8125rem] text-fl-dim">{line}</span>
        </span>
        <span className="inline-flex h-11 shrink-0 items-center rounded-[12px] bg-fl-ink px-5 text-[0.9375rem] font-semibold text-white group-open/r:bg-fl-band group-open/r:text-fl-ink">
          <span className="group-open/r:hidden">Reserve</span>
          <span className="hidden group-open/r:inline">Close</span>
        </span>
      </summary>
      <div className="border-t border-fl-rule px-5 pt-4 pb-5">
        {state.kind === "done" ? (
          <p role="status" className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <Check aria-hidden="true" className="size-5 text-fl-ok" />
            You&apos;re #{state.position}. We&apos;ll email you to set up your stores.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor={`${id}-email`} className="text-sm font-semibold">
              Work email
            </label>
            <input
              id={`${id}-email`}
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourstore.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-[12px] border border-fl-line bg-white px-3 text-[0.9375rem] placeholder:text-fl-dim"
            />
            <label htmlFor={`${id}-consent`} className="flex min-h-11 cursor-pointer items-start gap-2.5 py-1 text-sm text-fl-muted">
              <input id={`${id}-consent`} type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-fl-ink" />
              Email me about the store pilot. Unsubscribe anytime.
            </label>
            {/* Honeypot: off-screen, unfocusable, ignored by assistive tech. */}
            <input type="text" name="stoop_hp" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="submit"
                disabled={state.kind === "sending" || !consent}
                className={cn("inline-flex h-11 items-center rounded-[12px] bg-fl-ink px-5 text-[0.9375rem] font-semibold text-white hover:bg-[#2a2a2e] disabled:opacity-60")}
              >
                {state.kind === "sending" ? "Saving your spot" : "Reserve my stores"}
              </button>
              <span className="text-xs text-fl-dim">We never sell your email or send it to Qloo.</span>
            </div>
            {state.kind === "error" && (
              <p role="alert" className="text-sm font-semibold text-fl-bad">
                That didn&apos;t go through. Try again in a moment.
              </p>
            )}
          </form>
        )}
      </div>
    </details>
  );
}
