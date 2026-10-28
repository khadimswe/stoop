import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * The shape of the plan that is coming: the event sheet and the day, as skeletons. Shown while a
 * plan's data loads (a client navigation, a live plan's first events); never a blank screen.
 */
export function PlanSkeleton({ label = "Loading the plan..." }: { label?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-6 pb-16 sm:px-5 sm:pt-8">
      <p role="status" className="text-sm text-ink-soft">
        {label}
      </p>
      <div aria-hidden="true" className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div className="h-4 w-40 rounded bg-fill" />
          <div className="h-9 w-full max-w-xl rounded bg-fill" />
          <div className="h-5 w-full max-w-lg rounded bg-fill" />
          <div className="h-16 w-full rounded bg-fill" />
          <div className="h-12 w-full max-w-md rounded-lg bg-fill" />
        </div>
        <div className="h-72 rounded-xl bg-fill" />
      </div>
    </div>
  );
}

/** A plan state that is not a plan (not found, failed before it measured anything), with a way on. */
export function PlanStateCard({ title, children, exampleHref }: { title: string; children: ReactNode; exampleHref: string }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 pt-6 pb-20 sm:px-5 sm:pt-8">
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%]">{title}</h1>
      <div className="flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-hairline bg-surface p-4 text-sm sm:p-5">
        {children}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button asChild>
            <Link href={exampleHref}>See an example store</Link>
          </Button>
          <Button asChild variant="quiet">
            <Link href="/start">Plan an event</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
