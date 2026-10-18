"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { readRecents, RECENTS_KEY, timeAgo } from "@/lib/run/recents";

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readRaw = () => {
  try {
    return window.localStorage.getItem(RECENTS_KEY);
  } catch {
    return null;
  }
};

/**
 * "Recent campaigns": live runs started in this browser (localStorage, never sent anywhere). Renders
 * nothing on the server or when there are none, so the page never depends on it.
 */
export function RecentCampaigns() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const list = useMemo(() => readRecents({ getItem: () => raw, setItem: () => undefined, removeItem: () => undefined }), [raw]);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (list.length === 0) return null;

  return (
    <section aria-labelledby="recent-campaigns" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recent-campaigns" className="text-sm font-semibold">
          Recent campaigns
        </h2>
        <span className="text-xs text-ink-soft">Saved in this browser</span>
      </div>
      <ul className="overflow-hidden rounded-xl border border-hairline bg-surface">
        {list.map((entry) => (
          <li key={entry.runId} className="border-b border-hairline last:border-b-0">
            <Link href={entry.status === "ready" ? `/report/${entry.runId}` : `/run/${entry.runId}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-fill">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold">{entry.name}</span>
                <span className="text-xs text-ink-soft">{now === null ? " " : `Started ${timeAgo(entry.startedAt, now)}`}</span>
              </span>
              <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-semibold text-ink-soft">{entry.status === "ready" ? "Report ready" : "Running"}</span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-soft" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
