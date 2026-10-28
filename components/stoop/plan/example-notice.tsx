"use client";

import { Info, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { PLAN_NOTICE_KEY } from "@/lib/plan/view/start-form";

const noSubscription = () => () => {};

function readNotice(): string | null {
  try {
    return sessionStorage.getItem(PLAN_NOTICE_KEY);
  } catch {
    return null;
  }
}

/**
 * The message /start left when live plans were paused and it sent the manager to this example
 * instead ("Live plans are paused today, here is an example store"). Shown once, then cleared.
 */
export function ExampleNotice() {
  const stored = useSyncExternalStore(noSubscription, readNotice, () => null);
  const [closed, setClosed] = useState(false);
  if (!stored || closed) return null;
  const close = () => {
    try {
      sessionStorage.removeItem(PLAN_NOTICE_KEY);
    } catch {
      // Nothing to clear.
    }
    setClosed(true);
  };
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-ink bg-surface px-4 py-3 text-sm">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1">{stored}</p>
      <button type="button" onClick={close} aria-label="Dismiss" className="-my-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-fill">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
