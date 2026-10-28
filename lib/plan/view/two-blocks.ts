// "Two blocks, two tables": the landing's side-by-side of two kept plans. Each side is a store's
// block (for the map) and three lines of its plan (music, snacks, the wheel or giveaway), all taken
// from that store's own run.
import type { LocalView, PlanView } from "./plan";

export interface BlockSideView {
  storeName: string;
  city: string;
  title: string | null;
  block: NonNullable<LocalView["block"]> | null;
  uses: Record<string, string[]>;
  /** Three short lines: label and value, with whether Qloo picked it. */
  lines: { label: string; value: string; qloo: boolean }[];
  href: string;
  receipts: PlanView["receipts"];
}

export function blockSide(view: PlanView, href: string): BlockSideView {
  const lines = view.tiles
    .filter((t) => t.key !== "post")
    .map((t) => ({ label: t.label, value: t.note && t.key === "snacks" ? `${t.value}, ${t.note.replace(" away", "")}` : t.value, qloo: t.qloo }));
  // Only the receipts this side can open: its places.
  const keys = new Set((view.local.block?.places ?? []).map((p) => p.receipt).filter((k): k is string => k !== null));
  return {
    storeName: view.header.storeName,
    city: view.header.cityLine.split(",")[0] ?? view.header.cityLine,
    title: view.concept?.title ?? null,
    block: view.local.block,
    uses: view.placeUses,
    lines,
    href,
    receipts: Object.fromEntries(Object.entries(view.receipts).filter(([k]) => keys.has(k))),
  };
}
