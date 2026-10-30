"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { noticeCopy } from "@/lib/plan/view/notice";
import { cn } from "cn";
import { TEXT_LINK } from "./kit";
import { leaveStandIn, useNotice, writeNotice } from "./stand-in";

/**
 * When "Plan my event" opened this example instead of a live plan (live plans off, busy or used up),
 * the example's Event page says so at the top, in the server's words, with whose plan this is and the
 * way back. Read from what the Create step left in sessionStorage. Dismissing it leaves the quiet ways
 * back (./stand-in.tsx) that every page of the example store keeps.
 */
export function ExampleNotice({ slug, storeName, cityLine, className }: { slug: string; storeName: string; cityLine: string; className?: string }) {
  const { raw, notice } = useNotice();
  if (!notice || notice.dismissed || (notice.slug !== null && notice.slug !== slug)) return null;
  const { title, body } = noticeCopy(notice, { storeName, cityLine });
  const dismiss = () => {
    try {
      writeNotice(JSON.stringify({ ...(JSON.parse(raw ?? "{}") as object), dismissed: true }));
    } catch {
      writeNotice(null);
    }
  };
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-[20px] border border-fl-ink bg-white px-4 py-3.5", className)}>
      <i aria-hidden="true" className="mt-1.5 block size-2.5 shrink-0 rounded-[3px] bg-fl-signal ring-[1.5px] ring-fl-ink" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[0.9375rem] font-semibold">{title}</p>
        <p className="text-sm text-pretty text-fl-muted">{body}</p>
        <Link href={notice.back} onClick={leaveStandIn} className={cn(TEXT_LINK, "mt-1 self-start text-sm")}>
          Back to your store
        </Link>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss this note" className="-mt-1.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-[12px] text-fl-chev hover:bg-fl-sunk">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
