"use client";

import { Download, ExternalLink, ImageOff, Link2, Loader2, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import { Button } from "@/components/ui/button";
import type { PlanReport } from "@/lib/plan/schema";
import { marketingView, shareLinks, type MarketingView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { Card, PlanSection } from "./plan-section";

const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

type GenerateState = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "sent" };

/** Reads the marketing route's answer: the new poster and posts when it sends them back. */
function readMarketing(body: unknown): { poster: PlanReport["poster"] | null; posts: PlanReport["posts"] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const source = (b.report && typeof b.report === "object" ? b.report : b) as Record<string, unknown>;
  const poster = source.poster && typeof source.poster === "object" && "status" in source.poster ? (source.poster as PlanReport["poster"]) : null;
  const posts = source.posts && typeof source.posts === "object" && "facebook" in source.posts ? (source.posts as NonNullable<PlanReport["posts"]>) : null;
  if (!poster && !posts) return null;
  return { poster, posts };
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") return (body as { message: string }).message;
  if (status === 429) return "Posters are paused for today. The plan and the drafts still work.";
  return "The poster and posts could not be made right now. Try again in a minute.";
}

/**
 * The poster and the posts for Facebook, Instagram and WhatsApp: drafts the manager reviews, copies
 * and shares with one tap. Nothing posts on its own. When they are missing, "Generate poster and
 * posts" asks the marketing route to make them (an ink outline: the page's brick stays the sticky bar).
 */
export function MarketingSection({ view, planId, storeName, allowGenerate = true }: { view: MarketingView; planId: string; storeName: string; allowGenerate?: boolean }) {
  const [fresh, setFresh] = useState<MarketingView | null>(null);
  const [state, setState] = useState<GenerateState>({ kind: "idle" });
  const origin = useOrigin();
  // What the route sent back fills in until the page's own data (a live run's events) has it all.
  const m = view.posts && view.poster.status === "ready" ? view : (fresh ?? view);
  const eventUrl = `${origin}${m.eventPath}`;
  const missing = !m.posts || m.poster.status === "none" || m.poster.status === "failed";

  const generate = async () => {
    setState({ kind: "working" });
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(planId)}/marketing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) return setState({ kind: "error", message: errorMessage(body, response.status) });
      const made = readMarketing(body);
      if (made) {
        const next = marketingView(planId, storeName, made.poster ?? { status: "queued", prompt: "", promptHash: "", alt: "" }, made.posts);
        setFresh({ ...next, posts: next.posts ?? m.posts });
        setState({ kind: "idle" });
      } else setState({ kind: "sent" });
    } catch {
      setState({ kind: "error", message: "No connection. Check your signal and try again." });
    }
  };

  const share = m.posts ? shareLinks(eventUrl, m.posts.whatsapp) : null;
  return (
    <PlanSection
      id="marketing"
      kicker="Bring people in"
      title="Poster and posts"
      description="Drafts for you to check, copy and share. Nothing posts on its own: every post goes out only when you tap."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <PosterTile poster={m.poster} />
        <div className="flex flex-col gap-4">
          {m.posts ? (
            <>
              <PostCard channel="Facebook" text={m.posts.facebook}>
                <ShareLink href={m.posts.share.facebook ?? share?.facebook ?? null} label="Share on Facebook" />
              </PostCard>
              <PostCard channel="Instagram" text={`${m.posts.instagram}${m.posts.hashtags.length ? `\n\n${m.posts.hashtags.join(" ")}` : ""}`}>
                <span className="text-xs text-ink-soft">Instagram has no web share link: copy the caption, save the poster, then post it in the app.</span>
              </PostCard>
              <PostCard channel="WhatsApp" text={m.posts.whatsapp}>
                <ShareLink href={m.posts.share.whatsapp ?? share?.whatsapp ?? null} label="Send on WhatsApp" />
              </PostCard>
              <p className="text-xs text-ink-soft">Send WhatsApp messages only to people who asked to hear from the store.</p>
            </>
          ) : (
            <Card className="flex flex-col gap-2">
              <p className="text-sm font-semibold">No post drafts yet</p>
              <p className="text-sm text-ink-soft">The Facebook, Instagram and WhatsApp drafts are written from this plan and your offers.</p>
            </Card>
          )}
          <Card className="flex flex-col gap-2">
            <p className="text-sm font-semibold">The event page</p>
            <p className="text-sm text-ink-soft">One link for every post: the poster, the time, the address and your offers. No receipts or internals.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="quiet" size="sm">
                <Link href={m.eventPath}>
                  <ExternalLink aria-hidden="true" />
                  Open the event page
                </Link>
              </Button>
              <CopyButton text={eventUrl || m.eventPath} label="Copy link" variant="ghost" context="event page" />
            </div>
          </Card>
        </div>
      </div>
      {allowGenerate && missing && (
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" onClick={generate} disabled={state.kind === "working"}>
            {state.kind === "working" ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Sparkles aria-hidden="true" />}
            {state.kind === "working" ? "Making the poster and posts..." : "Generate poster and posts"}
          </Button>
          <p role="status" aria-live="polite" className={cn("text-sm", state.kind === "error" ? "text-rose-deep" : "text-ink-soft")}>
            {state.kind === "error" ? state.message : state.kind === "sent" ? "On the way. They show up here when they are ready; reload in a minute." : ""}
          </p>
        </div>
      )}
    </PlanSection>
  );
}

function PosterTile({ poster }: { poster: MarketingView["poster"] }) {
  return (
    <Card className="flex flex-col gap-3 self-start">
      {poster.src ? (
        <>
          <Image src={poster.src} alt={poster.alt} width={1080} height={1350} unoptimized className="aspect-[4/5] h-auto w-full rounded-lg bg-fill object-cover" />
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="quiet" size="sm">
              <a href={poster.src} download="event-poster.png">
                <Download aria-hidden="true" />
                Save the poster
              </a>
            </Button>
            <span className="text-xs text-ink-soft">AI-made. No carrier logos: add the store&apos;s official signage yourself.</span>
          </div>
        </>
      ) : (
        <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-lg bg-fill p-6 text-center">
          {poster.status === "queued" ? (
            <Loader2 aria-hidden="true" className="size-6 text-ink-soft motion-safe:animate-spin" />
          ) : (
            <ImageOff aria-hidden="true" className="size-6 text-ink-soft" />
          )}
          <p className="text-sm font-semibold">
            {poster.status === "queued" ? "Making the poster" : poster.status === "skipped" || poster.status === "failed" ? "No poster this time" : "No poster yet"}
          </p>
          {poster.reason && <p className="text-sm text-ink-soft">{poster.reason}</p>}
        </div>
      )}
    </Card>
  );
}

function PostCard({ channel, text, children }: { channel: string; text: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{channel} draft</h3>
        <CopyButton text={text} label="Copy" variant="quiet" context={`${channel} draft`} />
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line text-pretty">{text}</p>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </Card>
  );
}

function ShareLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Link2 aria-hidden="true" />
        {label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}
