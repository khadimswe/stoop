"use client";

import { Check, ChevronDown, Copy, Mail } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { askDrafts, mailtoHref, type AskDraft, type AskFacts } from "@/lib/plan/ask";
import { BUTTON2_SM, Fine, Section } from "./kit";
import { OriginTag } from "./receipts";

const noSubscription = () => () => {};
/** The manager's local day, "YYYY-MM-DD" (null on the server, so the first paint never guesses). */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function CopyDraft({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const ok = await copyText(text, event.currentTarget.parentElement ?? document.body);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };
  return (
    <>
      <button type="button" onClick={onClick} className={BUTTON2_SM}>
        {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === "copied" ? "Copied" : "Copy"}
        <span className="sr-only"> the draft {what}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed. Open the draft and copy it by hand." : ""}
      </span>
    </>
  );
}

function Draft({ draft, why }: { draft: AskDraft; why?: AskFacts["whyThere"] }) {
  const what = draft.to.charAt(0).toLowerCase() + draft.to.slice(1);
  return (
    <li className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-[0.9375rem] leading-5 font-semibold">{draft.to}</p>
        <p className="text-[0.8125rem] leading-[18px] text-pretty text-fl-dim">{draft.subject}</p>
        {why && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] leading-[18px] text-fl-muted">
            <span>Says why there, in Qloo&apos;s words</span>
            <OriginTag origin="qloo" receiptKey={why.receipt} context="why there" />
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyDraft text={draft.body} what={what} />
        <a href={mailtoHref(draft)} className={BUTTON2_SM}>
          <Mail aria-hidden="true" />
          Email<span className="sr-only"> the draft {what}</span>
        </a>
      </div>
      <details className="group/d">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Read the draft<span className="sr-only"> {what}</span>
          <ChevronDown aria-hidden="true" className="size-4 text-fl-chev transition-transform group-open/d:rotate-180 motion-reduce:transition-none" />
        </summary>
        <p className="mt-1 rounded-[12px] bg-fl-sunk px-3 py-2.5 text-[0.8125rem] leading-5 break-words whitespace-pre-line text-fl-muted">{draft.body}</p>
      </details>
    </li>
  );
}

/**
 * "Get the OK", on the Event step of a plan away from the store: a draft to the district manager and
 * one to the organizer, each with Copy and Email (the manager's own mail app, no recipient). Shown
 * only to the plan's owner and on the examples: the district manager's draft carries the budget.
 */
export function AskCard({ facts }: { facts: AskFacts }) {
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => "");
  const today = useSyncExternalStore(noSubscription, localToday, () => null);
  const drafts = askDrafts(facts, { origin, today });
  return (
    <Section id="get-the-ok" title="Get the OK" aside="Drafts">
      <p className="-mt-1 text-[0.8125rem] text-pretty text-fl-dim">Taking the table away from the store? Send these first.</p>
      <ul aria-label="Drafts to send" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
        <Draft draft={drafts.manager} why={facts.whyThere} />
        <Draft draft={drafts.organizer} />
      </ul>
      <Fine>Nothing sends from Stoop. Email opens your own mail app; add who it goes to.</Fine>
    </Section>
  );
}
