// "Two blocks, two tables": the landing's side-by-side of two kept plans. Each side is a store's
// poster (the poster route) and three short lines of its plan (playlist, snacks, prize wheel), all
// taken from that store's own run.
import type { PlanView } from "./plan";

export interface BlockSideView {
  storeName: string;
  city: string;
  title: string | null;
  poster: { src: string; alt: string } | null;
  /** Three short lines: label and value, with whether Qloo picked it. */
  lines: { label: string; value: string; qloo: boolean }[];
  href: string;
}

export function blockSide(view: PlanView, href: string): BlockSideView {
  const lines = view.tiles
    .filter((t) => t.key !== "post")
    .map((t) => ({ label: t.label, value: t.note && t.key === "snacks" ? `${t.value}, ${t.note.replace(" away", "")}` : t.value, qloo: t.qloo }));
  return {
    storeName: view.header.storeName,
    city: view.header.cityLine.split(",")[0] ?? view.header.cityLine,
    title: view.concept?.title ?? null,
    poster: view.marketing.poster.src ? { src: view.marketing.poster.src, alt: view.marketing.poster.alt } : null,
    lines,
    href,
  };
}
