"use client";

import { Download, ExternalLink, ImageOff, Link2, Loader2, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import { Screen } from "@/components/stoop/screen";
import { Button } from "@/components/ui/button";
import type { PlanReport } from "@/lib/plan/schema";
import { marketingView, shareLinks, type MarketingView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { PlanSection } from "./plan-section";

const noSubscription = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscription, () => window.location.origin, () => "");

type GenerateState = { kind: "idle" } | { kind: "working" } | { kind: "error"; message: string } | { kind: "sent" };
type Channel = "facebook" | "instagram" | "whatsapp";
const CHANNELS: { id: Channel; label: string }[] = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "whatsapp", label: "WhatsApp" },
];

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
  if (status === 429) return "Posters are paused today. Try tomorrow.";
  return "Couldn't make them right now. Try again.";
}

/**
 * "Post it": the poster (in a dark screen) and one draft per channel behind tabs, each with Copy and
 * a share link. Nothing posts on its own. "Make the poster and posts" calls the marketing route when
 * they are missing (an ink outline: the page's brick stays the sticky bar).
 */
export function MarketingSection({ view, planId, storeName, allowGenerate = true }: { view: MarketingView; planId: string; storeName: string; allowGenerate?: boolean }) {
  const [fresh, setFresh] = useState<MarketingView | null>(null);
  const [state, setState] = useState<GenerateState>({ kind: "idle" });
  const [channel, setChannel] = useState<Channel>("facebook");
  const tabs = useId();
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
      setState({ kind: "error", message: "No connection. Try again." });
    }
  };

  const share = m.posts ? shareLinks(eventUrl, m.posts.whatsapp) : null;
  const text = m.posts
    ? channel === "facebook"
      ? m.posts.facebook
      : channel === "instagram"
        ? `${m.posts.instagram}${m.posts.hashtags.length ? `\n\n${m.posts.hashtags.join(" ")}` : ""}`
        : m.posts.whatsapp
    : "";
  const shareHref = m.posts ? (channel === "facebook" ? (m.posts.share.facebook ?? share?.facebook) : channel === "whatsapp" ? (m.posts.share.whatsapp ?? share?.whatsapp) : null) : null;

  return (
    <PlanSection id="posts" title="Post it" description="Nothing posts until you tap.">
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Screen variant="app" className="flex flex-col items-center justify-center self-start p-3">
          {m.poster.src ? (
            <Image src={m.poster.src} alt={m.poster.alt} width={1080} height={1350} unoptimized className="aspect-[4/5] h-auto w-full rounded-lg object-cover" />
          ) : (
            <div className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 p-6 text-center text-paper">
              {m.poster.status === "queued" ? <Loader2 aria-hidden="true" className="size-6 motion-safe:animate-spin" /> : <ImageOff aria-hidden="true" className="size-6 text-paper-dim" />}
              <p className="text-sm font-semibold">{m.poster.status === "queued" ? "Making the poster" : "No poster yet"}</p>
              {m.poster.reason && <p className="text-sm text-paper-dim">{m.poster.reason}</p>}
            </div>
          )}
        </Screen>

        <div className="flex flex-col gap-3">
          {m.poster.src && (
            <Button asChild variant="quiet" size="sm" className="self-start">
              <a href={m.poster.src} download="event-poster.png">
                <Download aria-hidden="true" />
                Save poster
              </a>
            </Button>
          )}
          {m.posts ? (
            <div className="flex flex-col rounded-xl border border-hairline bg-surface">
              <div role="tablist" aria-label="Post drafts" className="flex border-b border-hairline px-1">
                {CHANNELS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    id={`${tabs}-${c.id}`}
                    aria-selected={channel === c.id}
                    aria-controls={`${tabs}-panel`}
                    onClick={() => setChannel(c.id)}
                    className={cn("min-h-11 flex-1 border-b-2 px-2 text-sm font-semibold", channel === c.id ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink")}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id={`${tabs}-panel`} aria-labelledby={`${tabs}-${channel}`} className="flex flex-col gap-3 p-4">
                <p className="text-sm leading-relaxed whitespace-pre-line text-pretty">{text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton text={text} label="Copy" variant="quiet" context={`${channel} draft`} />
                  {shareHref ? (
                    <Button asChild variant="ghost" size="sm">
                      <a href={shareHref} target="_blank" rel="noopener noreferrer">
                        <Link2 aria-hidden="true" />
                        {channel === "facebook" ? "Share" : "Send"}
                        <span className="sr-only"> on {channel} (opens in a new tab)</span>
                      </a>
                    </Button>
                  ) : (
                    <span className="text-xs text-ink-soft">Post it from the app.</span>
                  )}
                </div>
                {channel === "whatsapp" && <p className="text-xs text-ink-soft">Only to people who asked for store texts.</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">No post drafts yet.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="quiet" size="sm">
              <Link href={m.eventPath}>
                <ExternalLink aria-hidden="true" />
                Event page
              </Link>
            </Button>
            <CopyButton text={eventUrl || m.eventPath} label="Copy link" variant="ghost" context="event page" />
          </div>
          {allowGenerate && missing && (
            <div className="flex flex-col items-start gap-2 pt-1">
              <Button type="button" variant="outline" onClick={generate} disabled={state.kind === "working"}>
                {state.kind === "working" ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Sparkles aria-hidden="true" />}
                {state.kind === "working" ? "Making them..." : "Make the poster and posts"}
              </Button>
              <p role="status" aria-live="polite" className={cn("text-sm", state.kind === "error" ? "text-rose-deep" : "text-ink-soft")}>
                {state.kind === "error" ? state.message : state.kind === "sent" ? "On the way. Reload in a minute." : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </PlanSection>
  );
}
