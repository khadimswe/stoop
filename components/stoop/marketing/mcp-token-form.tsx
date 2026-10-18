"use client";

import { ArrowRight, Check, Mail, MailX } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { McpTokenResponse } from "@/lib/api/responses";
import { expiryText, postMcpToken, tokenErrorCopy, type McpTokenResult } from "@/lib/marketing/mcp-token";
import { cn } from "cn";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; code: Exclude<McpTokenResult, { ok: true }>["code"] }
  | { kind: "done"; token: McpTokenResponse };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * /mcp's "Get a token": email required, an optional consent to product emails, and the honeypot.
 * The token is shown once, with a copy button and a plain warning that it won't be shown again,
 * plus whether the email copy went out. Errors and limits are said in plain words.
 */
export function McpTokenForm({ className }: { className?: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const emailRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state.kind === "done") doneRef.current?.focus();
  }, [state.kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setInvalid(true);
      emailRef.current?.focus();
      return;
    }
    setInvalid(false);
    // Honeypot: people never see or fill it. The server answers a filled one like a success and drops it.
    const company = new FormData(event.currentTarget).get("stoop_hp")?.toString() || undefined;
    setState({ kind: "sending" });
    const result = await postMcpToken({ email, consent, ...(company ? { company } : {}) });
    setState(result.ok ? { kind: "done", token: result.token } : { kind: "error", code: result.code });
  }

  if (state.kind === "done") {
    const { token, expiresAt, emailed } = state.token;
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <h3 ref={doneRef} tabIndex={-1} className="flex items-center gap-2 font-display text-2xl font-extrabold [font-stretch:85%] focus-visible:outline-offset-4">
          <Check aria-hidden="true" className="size-6 text-ink" />
          Your token
        </h3>
        <div className="flex flex-col gap-2 rounded-lg border-[1.5px] border-concrete-line bg-fill p-3 sm:flex-row sm:items-center">
          <code data-testid="mcp-token" className="min-w-0 flex-1 font-mono text-sm break-all text-ink select-all">
            {token}
          </code>
          <CopyButton text={token} label="Copy" variant="quiet" size="sm" className="shrink-0 self-start sm:self-auto" />
        </div>
        <p className="text-base leading-snug font-semibold">We won&apos;t show it again. Copy it now and keep it somewhere safe.</p>
        <p className="flex items-start gap-2 text-sm text-ink-soft">
          {emailed ? <Mail aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <MailX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {emailed ? "We also emailed it to you." : "We couldn't email a copy this time, so copy it before you leave this page."}
        </p>
        <p className="text-sm text-ink-soft">Works until {expiryText(expiresAt)}.</p>
        <a href="#setup" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-bold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
          Next: add Stoop to Claude
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-email`} className="font-semibold">
          Email
        </Label>
        <Input
          ref={emailRef}
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourbrand.com"
          value={email}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-email-error` : `${id}-email-hint`}
          onChange={(event) => {
            setEmail(event.target.value);
            if (invalid) setInvalid(false);
          }}
          className="h-11 rounded-lg border-concrete-line bg-fill"
        />
        {invalid ? (
          <p id={`${id}-email-error`} className="text-sm font-semibold text-rose-deep">
            Enter your email address. We send the token there too.
          </p>
        ) : (
          <p id={`${id}-email-hint`} className="text-sm text-ink-soft">
            We email the token once, as a backup.
          </p>
        )}
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id={`${id}-consent`}
          checked={consent}
          onCheckedChange={(value) => setConsent(value === true)}
          className="mt-0.5 border-[1.5px] border-concrete-line"
        />
        <Label htmlFor={`${id}-consent`} className="text-sm leading-snug font-medium text-ink-soft">
          Also send me Stoop product updates. Optional, unsubscribe anytime.
        </Label>
      </div>

      {/* Honeypot: off-screen, unfocusable, ignored by assistive tech. */}
      <input type="text" name="stoop_hp" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" />

      <Button type="submit" disabled={state.kind === "sending"} className="self-start">
        {state.kind === "sending" ? "Getting your token" : "Get my token"}
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>

      {state.kind === "error" && (
        <p role="alert" className="text-sm font-semibold text-rose-deep">
          {tokenErrorCopy(state.code)}
        </p>
      )}
      <p className="text-xs leading-relaxed text-ink-soft">Your email joins the Stoop waitlist. We never sell it or send it to Qloo.</p>
    </form>
  );
}
