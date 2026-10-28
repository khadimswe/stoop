"use client";

import { Check, ChevronLeft, Copy, Download } from "lucide-react";
import Image from "next/image";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { MetaConnect } from "@/components/stoop/promote/meta-connect";
import type { PlanInputs } from "@/lib/plan/schema";
import { agentPosts, type AgentPost } from "@/lib/plan/view/floor";
import { shareLinks, type PlanView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "./glyphs";
import { ActionBar, AppBar, BUTTON2_SM, Fine, IconSlot, Notice, PRIMARY, ScreenTitle, Section, Stepper, TEXT_LINK, type Step } from "./kit";

const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

function Account({ glyph, on, title, sub, action }: { glyph: ReactNode; on: boolean; title: string; sub: string; action: ReactNode }) {
  return (
    <li className="flex min-h-[64px] items-center gap-3 px-4 py-3">
      <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-[18px]", on ? "bg-fl-ink text-white" : "bg-fl-band text-fl-ink")}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] leading-5 font-medium">{title}</span>
        <span className="block text-[0.8125rem] text-fl-dim">{sub}</span>
      </span>
      {action}
    </li>
  );
}

/** One-tap share: where posting from Stoop is off (and for the example stores). */
function ShareMode({ view, posts, eventUrl }: { view: PlanView; posts: AgentPost[]; eventUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const share = view.marketing.posts ? shareLinks(eventUrl, view.marketing.posts.whatsapp) : null;
  const list = posts.map((p) => (p.id === "announce" && edited !== null ? { ...p, text: edited } : p));
  const copy = async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    }
  };
  const shareNow = async () => {
    const text = list[0]?.text ?? view.concept?.title ?? "";
    try {
      if (navigator.share) {
        await navigator.share({ title: view.concept?.title ?? view.header.storeName, text, url: eventUrl });
        return;
      }
    } catch {
      return; // The manager closed the share sheet.
    }
    if (share) window.open(share.facebook, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Section title="Accounts">
        <ul aria-label="Accounts" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          <Account
            glyph={<FacebookGlyph />}
            on
            title="Facebook Page"
            sub="Share dialog"
            action={
              share && (
                <a href={share.facebook} target="_blank" rel="noopener noreferrer" className={BUTTON2_SM}>
                  Share<span className="sr-only"> on Facebook (opens in a new tab)</span>
                </a>
              )
            }
          />
          <Account
            glyph={<InstagramGlyph />}
            on={false}
            title="Instagram"
            sub="Copy the caption, post the poster"
            action={
              view.marketing.posts && (
                <button type="button" onClick={() => copy("ig", `${view.marketing.posts!.instagram}\n\n${view.marketing.posts!.hashtags.join(" ")}`)} className={BUTTON2_SM}>
                  {copied === "ig" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  {copied === "ig" ? "Copied" : "Caption"}
                  <span className="sr-only"> for Instagram</span>
                </button>
              )
            }
          />
          <Account
            glyph={<WhatsAppGlyph />}
            on={false}
            title="WhatsApp"
            sub="Groups and status"
            action={
              share && (
                <a href={share.whatsapp} target="_blank" rel="noopener noreferrer" className={BUTTON2_SM}>
                  Share<span className="sr-only"> on WhatsApp (opens in a new tab)</span>
                </a>
              )
            }
          />
        </ul>
      </Section>

      {list.length > 0 && (
        <Section title="The agent's plan" aside={`${list.length} posts`}>
          <ul aria-label="Posts and when to share them" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            {list.map((p, i) => (
              <li key={p.id} className="flex flex-col gap-3 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="w-[5.5rem] shrink-0 text-sm font-semibold tabular-nums">{p.when}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] leading-5 font-semibold">{p.title}</span>
                    <span className="block text-[0.8125rem] text-fl-dim">{p.channels}</span>
                  </span>
                  <button type="button" onClick={() => copy(p.id, p.text)} className={BUTTON2_SM}>
                    {copied === p.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied === p.id ? "Copied" : "Copy"}
                    <span className="sr-only"> the {p.title.toLowerCase()} post</span>
                  </button>
                </div>
                {i === 0 && (
                  <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-3 sm:ml-[6.25rem]">
                    {view.marketing.poster.thumb ? <Image src={view.marketing.poster.thumb} alt="" width={128} height={160} unoptimized className="aspect-[4/5] h-auto w-16 rounded-[6px]" /> : <span />}
                    <div className="flex flex-col gap-1.5">
                      {editing ? (
                        <textarea
                          aria-label="Announce post text"
                          value={p.text}
                          rows={6}
                          maxLength={2000}
                          onChange={(e) => setEdited(e.target.value)}
                          className="w-full rounded-[12px] border border-fl-line bg-white p-2 text-[0.8125rem] leading-[18px] text-fl-ink"
                        />
                      ) : (
                        <p className="line-clamp-4 text-[0.8125rem] leading-[18px] whitespace-pre-line text-fl-muted">{p.text}</p>
                      )}
                      <button type="button" onClick={() => setEditing((v) => !v)} className={cn(TEXT_LINK, "self-start text-sm")}>
                        {editing ? "Done" : "Edit text"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Fine>WhatsApp opens your share sheet. You pick the chats. Send only to people who asked for store texts.</Fine>
        </Section>
      )}
      {view.marketing.poster.src && (
        <a href={view.marketing.poster.src} download="event-poster.png" className={cn(TEXT_LINK, "inline-flex items-center gap-1.5 self-start text-sm")}>
          <Download aria-hidden="true" className="size-4" />
          Save the poster
        </a>
      )}
      <ActionBar note="Posting from Stoop is off here. Share in one tap instead.">
        <button type="button" onClick={shareNow} disabled={!view.marketing.posts} className={PRIMARY}>
          Share the event
        </button>
      </ActionBar>
    </>
  );
}

/**
 * Step 5, promote: "Nothing posts until you approve." With posting on (ENABLE_META_POSTING), the
 * store's accounts and the agent's plan of posts to approve (components/stoop/promote/meta-connect.tsx);
 * where it is off, or for an example store, the same screen shares in one tap instead.
 */
export function PromoteScreen({ view, inputs, hrefs }: { view: PlanView; inputs: PlanInputs; hrefs: { back: string; steps: Partial<Record<Step, string>> } }) {
  const origin = useOrigin();
  const eventUrl = `${origin}${view.marketing.eventPath}`;
  const posts = agentPosts(view, inputs);
  const share = view.marketing.posts ? shareLinks(eventUrl, view.marketing.posts.whatsapp) : null;
  return (
    <>
      <AppBar
        left={
          <IconSlot href={hrefs.back} label="Back to the poster">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Promote"
      />
      <Stepper current="Promote" hrefs={hrefs.steps} />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-7 px-4 pt-5 pb-8">
        <ScreenTitle title="Promote" meta="Nothing posts until you approve." />
        {!view.marketing.posts && <Notice title="No post drafts yet">They&apos;re written from the plan and your promos once the poster is ready.</Notice>}
        <MetaConnect
          planId={view.id}
          inputs={inputs}
          ready={view.marketing.posts !== null && view.marketing.poster.src !== null}
          whatsappHref={share?.whatsapp ?? null}
          fallback={<ShareMode view={view} posts={posts} eventUrl={eventUrl} />}
        />
        {view.header.fictional && <Fine>{view.header.fictional}</Fine>}
      </main>
    </>
  );
}
