"use client";

import { Check, ChevronLeft, Copy, Download } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { copyText } from "@/components/stoop/copy-button";
import { agentPosts, type AgentPost } from "@/lib/plan/view/floor";
import { apiMessageOf } from "@/lib/plan/view/live";
import { shareLinks, type PlanView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { FacebookGlyph, InstagramGlyph, WhatsAppGlyph } from "./glyphs";
import { ActionBar, AppBar, BUTTON2_SM, Fine, IconSlot, Notice, PRIMARY, ScreenTitle, Section, Stepper, TEXT_LINK, type Step } from "./kit";

const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

/** What the posting service says about this store's accounts. Null: posting from Stoop is off here. */
interface Accounts {
  facebook: { connected: boolean; name: string | null };
  instagram: { connected: boolean; name: string | null };
}

function readAccounts(body: unknown): Accounts | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, { connected?: unknown; name?: unknown; page?: unknown; username?: unknown } | undefined>;
  const side = (x: (typeof b)[string]) => ({ connected: x?.connected === true, name: typeof x?.name === "string" ? x.name : typeof x?.page === "string" ? x.page : typeof x?.username === "string" ? x.username : null });
  if (!b.facebook && !b.instagram) return null;
  return { facebook: side(b.facebook), instagram: side(b.instagram) };
}

type Send = { kind: "idle" } | { kind: "sending" } | { kind: "done"; message: string } | { kind: "error"; message: string };

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

/**
 * Step 5, promote: the accounts, then the agent's plan of three posts (now, the evening before, just
 * before the table opens), each ticked by default. Nothing posts until the manager approves. Where
 * posting from Stoop is off (the posting routes answer 404) the same screen shares in one tap instead:
 * the Facebook share dialog, WhatsApp, the caption to copy and the poster to save.
 */
export function PromoteScreen({ view, inputs, hrefs }: { view: PlanView; inputs: { date: string; startTime: string }; hrefs: { back: string; steps: Partial<Record<Step, string>> } }) {
  const origin = useOrigin();
  const [accounts, setAccounts] = useState<Accounts | null | "checking">("checking");
  const [picked, setPicked] = useState<Record<string, boolean>>({ announce: true, reminder: true, outside: true });
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [send, setSend] = useState<Send>({ kind: "idle" });
  const [copied, setCopied] = useState<string | null>(null);
  const posts = agentPosts(view, inputs).map((p): AgentPost => (p.id === "announce" && edited !== null ? { ...p, text: edited } : p));
  const eventUrl = `${origin}${view.marketing.eventPath}`;
  const share = view.marketing.posts ? shareLinks(eventUrl, view.marketing.posts.whatsapp) : null;
  const posterSrc = view.marketing.poster.src;

  useEffect(() => {
    let stopped = false;
    fetch(`/api/social/meta/status?plan=${encodeURIComponent(view.id)}`, { headers: { accept: "application/json" } })
      .then(async (r) => (r.ok ? readAccounts(await r.json().catch(() => null)) : null))
      .catch(() => null)
      .then((a) => !stopped && setAccounts(a));
    return () => {
      stopped = true;
    };
  }, [view.id]);

  const meta = accounts !== "checking" && accounts !== null;
  const chosen = posts.filter((p) => picked[p.id]);
  const copy = async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    }
  };

  const approve = async () => {
    setSend({ kind: "sending" });
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(view.id)}/social/post`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ posts: chosen.map((p) => ({ slot: p.id, text: p.text, channels: ["facebook", "instagram"] })) }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 404) {
        setAccounts(null);
        return setSend({ kind: "idle" });
      }
      setSend(response.ok ? { kind: "done", message: apiMessageOf(body) ?? `${chosen.length} posts approved.` } : { kind: "error", message: apiMessageOf(body) ?? "Those posts didn't go out. Nothing was posted. Try again." });
    } catch {
      setSend({ kind: "error", message: "No connection. Nothing was posted. Try again." });
    }
  };

  const shareNow = async () => {
    const text = posts[0]?.text ?? view.concept?.title ?? "";
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

        <Section title="Accounts">
          <ul aria-label="Accounts" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
            <Account
              glyph={<FacebookGlyph />}
              on={meta ? accounts.facebook.connected : true}
              title="Facebook Page"
              sub={meta ? (accounts.facebook.connected ? (accounts.facebook.name ?? view.header.storeName) : "Not connected") : "Share dialog"}
              action={
                meta ? (
                  accounts.facebook.connected ? (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-fl-ok">
                      <Check aria-hidden="true" className="size-4" />
                      Connected
                    </span>
                  ) : (
                    <a href={`/api/social/meta/connect?plan=${encodeURIComponent(view.id)}`} className={BUTTON2_SM}>
                      Connect
                    </a>
                  )
                ) : share ? (
                  <a href={share.facebook} target="_blank" rel="noopener noreferrer" className={BUTTON2_SM}>
                    Share<span className="sr-only"> on Facebook (opens in a new tab)</span>
                  </a>
                ) : null
              }
            />
            <Account
              glyph={<InstagramGlyph />}
              on={meta ? accounts.instagram.connected : false}
              title="Instagram"
              sub={meta ? (accounts.instagram.connected ? (accounts.instagram.name ?? "Connected") : "Not connected") : "Copy the caption, post the poster"}
              action={
                meta && !accounts.instagram.connected ? (
                  <a href={`/api/social/meta/connect?plan=${encodeURIComponent(view.id)}&to=instagram`} className={BUTTON2_SM}>
                    Connect
                  </a>
                ) : meta ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-fl-ok">
                    <Check aria-hidden="true" className="size-4" />
                    Connected
                  </span>
                ) : view.marketing.posts ? (
                  <button type="button" onClick={() => copy("ig", `${view.marketing.posts!.instagram}\n\n${view.marketing.posts!.hashtags.join(" ")}`)} className={BUTTON2_SM}>
                    {copied === "ig" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied === "ig" ? "Copied" : "Caption"}
                  </button>
                ) : null
              }
            />
            <Account
              glyph={<WhatsAppGlyph />}
              on={false}
              title="WhatsApp"
              sub="Groups and status"
              action={
                share ? (
                  <a href={share.whatsapp} target="_blank" rel="noopener noreferrer" className={BUTTON2_SM}>
                    Share<span className="sr-only"> on WhatsApp (opens in a new tab)</span>
                  </a>
                ) : null
              }
            />
          </ul>
          {meta && !accounts.instagram.connected && <Fine>Instagram not connected: posts go to Facebook only until you connect it.</Fine>}
        </Section>

        {posts.length > 0 && (
          <Section title="The agent's plan" aside={`${posts.length} posts`}>
            <ul aria-label="Posts to approve" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
              {posts.map((p, i) => (
                <li key={p.id} className="flex flex-col gap-3 px-4 py-3.5">
                  <label className="flex items-center gap-3">
                    <span className="w-[5.5rem] shrink-0 text-sm font-semibold tabular-nums">{p.when}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] leading-5 font-semibold">{p.title}</span>
                      <span className="block text-[0.8125rem] text-fl-dim">{meta ? p.channels : "Post it yourself at this time"}</span>
                    </span>
                    {meta ? (
                      <input type="checkbox" checked={Boolean(picked[p.id])} onChange={(e) => setPicked((v) => ({ ...v, [p.id]: e.target.checked }))} className="size-6 shrink-0 accent-fl-ink" />
                    ) : (
                      <button type="button" onClick={() => copy(p.id, p.text)} className={BUTTON2_SM}>
                        {copied === p.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        {copied === p.id ? "Copied" : "Copy"}
                        <span className="sr-only"> the {p.title.toLowerCase()} post</span>
                      </button>
                    )}
                  </label>
                  {i === 0 && (
                    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-3 sm:ml-[6.25rem]">
                      {view.marketing.poster.thumb ? <Image src={view.marketing.poster.thumb} alt="" width={128} height={160} unoptimized className="aspect-[4/5] w-16 rounded-[6px] object-cover" /> : <span />}
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

        {posterSrc && !meta && (
          <a href={posterSrc} download="event-poster.png" className={cn(TEXT_LINK, "inline-flex items-center gap-1.5 self-start text-sm")}>
            <Download aria-hidden="true" className="size-4" />
            Save the poster
          </a>
        )}
        {send.kind === "done" && <Notice title="Approved">{send.message}</Notice>}
        {send.kind === "error" && (
          <Notice tone="bad" title="Nothing was posted">
            {send.message}
          </Notice>
        )}
        {view.header.fictional && <Fine>{view.header.fictional}</Fine>}
      </main>
      <ActionBar note={meta ? undefined : "Posting from Stoop is off here. Share in one tap instead."}>
        {meta ? (
          <button type="button" onClick={approve} disabled={chosen.length === 0 || send.kind === "sending" || send.kind === "done"} className={PRIMARY}>
            {send.kind === "sending" ? "Approving..." : send.kind === "done" ? "Approved" : `Approve ${chosen.length} ${chosen.length === 1 ? "post" : "posts"}`}
          </button>
        ) : (
          <button type="button" onClick={shareNow} disabled={!view.marketing.posts} className={PRIMARY}>
            Share the event
          </button>
        )}
      </ActionBar>
    </>
  );
}
