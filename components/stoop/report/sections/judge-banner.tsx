import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { JudgeBannerView } from "@/lib/report/view/types";

// Stub (judge pass lane): the quiet strip shown above the Reality Check while a judge pass is active.
// The pass is a cookie, so the page decides on the client and passes this into ReportPage's `banner`
// slot. Ink outline button: the brick sticky bar stays the one primary per view. No timer.
export function JudgeBanner({ view = { tryHref: "/start" } }: { view?: JudgeBannerView }) {
  return (
    <aside aria-label="Judge pass" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-4 py-2.5">
      <p className="text-sm font-semibold">Judge pass active: video renders unlocked</p>
      <Button asChild variant="outline" size="sm">
        <Link href={view.tryHref}>Try it with your link</Link>
      </Button>
    </aside>
  );
}
