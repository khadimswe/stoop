"use client";

import { ArrowRight, Check } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { SELLS_ON, type SellsOn } from "./sells-on";

export interface WaitlistSignup {
  email: string;
  sellsOn: SellsOn | null;
  consent: boolean;
}

/**
 * "Get a free brief": the waitlist. Email plus where they sell; the product link is asked for on
 * the success screen, where it doubles as the free-brief request. A hidden honeypot field catches bots.
 * Without `onSubmit` (before the backend exists) the form is shown but cannot be sent.
 */
export function WaitlistForm({
  onSubmit,
  className,
}: {
  onSubmit?: (signup: WaitlistSignup) => Promise<{ position: number }>;
  className?: string;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [sellsOn, setSellsOn] = useState<SellsOn | null>(null);
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<{ kind: "idle" | "sending" | "error" } | { kind: "done"; position: number }>({
    kind: "idle",
  });

  if (state.kind === "done") return <WaitlistSuccess position={state.position} className={className} />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("company")) return; // honeypot: humans never see or fill this field
    if (!onSubmit) return;
    setState({ kind: "sending" });
    try {
      const { position } = await onSubmit({ email, sellsOn, consent });
      setState({ kind: "done", position });
    } catch {
      setState({ kind: "error" });
    }
  }

  return (
    <form onSubmit={submit} className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`} className="font-semibold">
          Email
        </Label>
        <Input
          id={`${id}-email`}
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourbrand.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11 rounded-lg border-concrete-line bg-fill"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">I sell on</legend>
        <div className="flex flex-wrap gap-2">
          {SELLS_ON.map((option) => (
            <label key={option.value} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-sells-on`}
                value={option.value}
                checked={sellsOn === option.value}
                onChange={() => setSellsOn(option.value)}
                className="peer sr-only"
              />
              <span className="inline-flex items-center rounded-full border-[1.5px] border-concrete-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-soft transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`${id}-consent`}
          checked={consent}
          onCheckedChange={(value) => setConsent(value === true)}
          required
          className="mt-0.5 border-[1.5px] border-concrete-line"
        />
        <Label htmlFor={`${id}-consent`} className="text-sm leading-snug font-medium text-ink-soft">
          Email me my free brief and Stoop updates. Unsubscribe anytime.
        </Label>
      </div>

      {/* Honeypot: off-screen, unfocusable, ignored by assistive tech. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />

      <Button type="submit" disabled={!onSubmit || state.kind === "sending" || !consent} className="self-start">
        {state.kind === "sending" ? "Saving your spot" : "Get my free brief"}
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>

      <p className="text-xs text-ink-soft">
        {onSubmit
          ? "We never sell your email or send it to Qloo."
          : "The waitlist opens with the beta. We never sell your email or send it to Qloo."}
      </p>
      {state.kind === "error" && (
        <p role="alert" className="text-sm font-semibold text-rose-deep">
          That didn&apos;t go through. Try again in a moment.
        </p>
      )}
    </form>
  );
}

/** Success screen: confirms the spot and asks for the product link, which becomes the free-brief request. */
export function WaitlistSuccess({
  position,
  onProductLink,
  className,
}: {
  position: number;
  onProductLink?: (url: string) => Promise<void>;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-4", className)} role="status">
      <p className="flex items-center gap-2 font-display text-2xl font-extrabold [font-stretch:85%]">
        <Check aria-hidden="true" className="size-6 text-dusk" />
        You&apos;re #{position}.
      </p>
      <p className="text-ink-soft">Paste your product link and we&apos;ll send your free Culture Brief.</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const url = new FormData(event.currentTarget).get("product")?.toString() ?? "";
          if (onProductLink && url) void onProductLink(url);
        }}
      >
        <Label htmlFor={`${id}-product`} className="sr-only">
          Product link
        </Label>
        <Input
          id={`${id}-product`}
          name="product"
          type="url"
          placeholder="https://"
          className="h-11 rounded-lg border-concrete-line bg-fill"
        />
        <Button type="submit" variant="quiet" disabled={!onProductLink}>
          Send
        </Button>
      </form>
      <p className="text-xs text-ink-soft">Check your inbox for a confirmation.</p>
    </div>
  );
}
