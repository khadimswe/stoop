"use client";

import { useEffect, useState } from "react";
import { agesLine, agesViewOf, skewText, type AgesView } from "@/lib/plan/view/ages";
import { cn } from "cn";
import { Fine, Section } from "./kit";
import { FloorReceipts, OriginTag } from "./receipts";

const RECEIPT_KEY = "community-ages";

/**
 * "Who loves these spots": the adult age bands the people who love the community's places skew
 * toward, from one Qloo call made after the page renders. While it loads, and on any failure or empty
 * answer, it renders nothing: the Community step looks exactly as it did without it.
 */
export function CommunityAges({ url, from = "the store" }: { url: string; from?: "the store" | "the event" }) {
  const [view, setView] = useState<AgesView | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then((response) => (response.status === 200 ? response.json() : null))
      .then((body: unknown) => {
        const checked = agesViewOf(body);
        if (checked) setView(checked);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [url]);
  if (!view) return null;

  const max = Math.max(0.05, ...view.bands.map((b) => Math.abs(b.skew)));
  return (
    <FloorReceipts receipts={{ [RECEIPT_KEY]: view.receipt }}>
      <Section id="who-loves-these-spots" title="Who loves these spots" aside={<OriginTag origin="qloo" receiptKey={RECEIPT_KEY} context="who loves these spots" />}>
        <p className="-mt-1 text-sm text-pretty">
          {agesLine("", from)}
          <span className="whitespace-nowrap">
            {view.top} <span className="text-fl-dim">(Qloo)</span>
          </span>
        </p>
        <ul aria-label="Age skew by adult band, from -1 to 1" className="flex flex-col gap-1.5 rounded-[20px] bg-white px-4 py-3.5">
          {view.bands.map((b) => {
            const width = `${Math.round((Math.abs(b.skew) / max) * 50)}%`;
            return (
              <li key={b.bucket} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-[0.8125rem]">
                <span className={cn(b.skew > 0 ? "font-medium text-fl-ink" : "text-fl-muted")}>{b.label}</span>
                <span aria-hidden="true" className="relative h-2 rounded-full bg-fl-band">
                  <i className="absolute inset-y-[-2px] left-1/2 w-px bg-fl-line" />
                  <i className={cn("absolute inset-y-0 block rounded-full", b.skew >= 0 ? "left-1/2 bg-fl-ink" : "right-1/2 bg-fl-chev")} style={{ width }} />
                </span>
                <span className="text-right font-mono text-xs text-fl-dim">
                  <span className="sr-only">skews </span>
                  {skewText(b.skew)}
                </span>
              </li>
            );
          })}
        </ul>
        <Fine>
          Skew from -1 to 1 across {view.spots} {view.spots === 1 ? "place" : "places"} near {from === "the event" ? "the event" : "your store"}, not a share of anyone. Adults only.
        </Fine>
      </Section>
    </FloorReceipts>
  );
}
