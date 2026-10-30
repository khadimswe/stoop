"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { PLAN_EXAMPLES } from "@/lib/plan/example-list";
import { parsePlanNotice, sameStore, standInBar } from "@/lib/plan/view/notice";
import { PLAN_NOTICE_KEY } from "@/lib/plan/view/start-form";
import { cn } from "cn";

// The stand-in note's browser wiring: what the Create step left in sessionStorage when an example
// opened in place of someone's own plan, read on the client only, and the quiet ways back to their
// store that every page of that example store keeps. No imports from ./kit (the header uses this).

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};
const read = () => {
  try {
    return sessionStorage.getItem(PLAN_NOTICE_KEY);
  } catch {
    return null;
  }
};

/** Replaces (or, with null, clears) the note and tells every reader on the page. */
export function writeNotice(raw: string | null) {
  try {
    if (raw === null) sessionStorage.removeItem(PLAN_NOTICE_KEY);
    else sessionStorage.setItem(PLAN_NOTICE_KEY, raw);
  } catch {
    // Private browsing: nothing was kept.
  }
  for (const l of listeners) l();
}

/** The note the Create step left; nothing on the server and the first render. */
export function useNotice() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return { raw, notice: parsePlanNotice(raw) };
}

/** Going back to your own store: the note has done its job. */
export const leaveStandIn = () => writeNotice(null);

const LINK = "font-medium text-fl-ink underline decoration-1 underline-offset-[3px] hover:decoration-2";

/**
 * The phone's quiet bar over every page of an example store while it stands in for someone's own
 * store: whose pages these are, and "Back to your store". It can't be dismissed; it goes when the
 * manager goes back. On the Event page (`withNote`) it waits until the full note there is dismissed,
 * so it is said once. From 1024 px the header carries the way back instead (`StandInLink`).
 */
export function StandInBar({ slug, storeName, withNote = false }: { slug: string; storeName: string; withNote?: boolean }) {
  const { notice } = useNotice();
  const bar = standInBar(notice, { slug, storeName });
  if (!bar || (withNote && !notice?.dismissed)) return null;
  return (
    <div role="region" aria-label="Example store" className="border-b border-fl-rule bg-white lg:hidden">
      <div className="mx-auto flex min-h-11 max-w-xl items-center gap-3 px-4 py-1.5">
        <i aria-hidden="true" className="block size-2.5 shrink-0 rounded-[3px] bg-fl-signal ring-[1.5px] ring-fl-ink" />
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-[18px] text-pretty text-fl-muted">{bar.text}</p>
        <Link href={bar.back} onClick={leaveStandIn} className={cn(LINK, "inline-flex min-h-11 shrink-0 items-center gap-1 text-sm")}>
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to your store
        </Link>
      </div>
    </div>
  );
}

/**
 * The desktop header's way back, beside "My stores", on every page of an example store that stands in
 * for someone's own store (found by the header's store name). It stays in the sticky header.
 */
export function StandInLink({ storeName }: { storeName: string | null | undefined }) {
  const { notice } = useNotice();
  const example = storeName ? PLAN_EXAMPLES.find((e) => sameStore(e.storeName, storeName)) : undefined;
  const bar = example ? standInBar(notice, { slug: example.slug, storeName: example.storeName }) : null;
  if (!bar) return null;
  return (
    <Link href={bar.back} onClick={leaveStandIn} title={bar.text} className={cn(LINK, "inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-sm whitespace-nowrap")}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      <span className="hidden text-fl-dim xl:inline">Example store ·&nbsp;</span>
      Back to your store
    </Link>
  );
}
