"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { noticeCopy, parsePlanNotice } from "@/lib/plan/view/notice";
import { PLAN_NOTICE_KEY } from "@/lib/plan/view/start-form";
import { cn } from "cn";
import { TEXT_LINK } from "./kit";

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

/**
 * When "Plan my event" opened this example instead of a live plan (live plans off, busy or used up),
 * the example's pages say so at the top, in the server's words, with whose plan this is and the way
 * back. Read from what the Create step left in sessionStorage; it stays until dismissed.
 */
export function ExampleNotice({ slug, storeName, cityLine, className }: { slug: string; storeName: string; cityLine: string; className?: string }) {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const notice = parsePlanNotice(raw);
  if (!notice || (notice.slug !== null && notice.slug !== slug)) return null;
  const { title, body } = noticeCopy(notice, { storeName, cityLine });
  const dismiss = () => {
    try {
      sessionStorage.removeItem(PLAN_NOTICE_KEY);
    } catch {
      // Private browsing: nothing was kept.
    }
    for (const l of listeners) l();
  };
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-[20px] border border-fl-ink bg-white px-4 py-3.5", className)}>
      <i aria-hidden="true" className="mt-1.5 block size-2.5 shrink-0 rounded-[3px] bg-fl-signal ring-[1.5px] ring-fl-ink" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[0.9375rem] font-semibold">{title}</p>
        <p className="text-sm text-pretty text-fl-muted">{body}</p>
        <Link href={notice.back} onClick={dismiss} className={cn(TEXT_LINK, "mt-1 self-start text-sm")}>
          Back to your store
        </Link>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss this note" className="-mt-1.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-[12px] text-fl-chev hover:bg-fl-sunk">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
