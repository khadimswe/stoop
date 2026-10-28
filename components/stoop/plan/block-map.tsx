"use client";

import { useState } from "react";
import { mapMode, projectPlaces, ringRadius, stripX, WALK_RINGS } from "@/lib/plan/view/block-map";
import type { LocalView, PlaceView } from "@/lib/plan/view/plan";
import { cn } from "cn";
import { ReceiptLink } from "./receipt-link";

type Block = NonNullable<LocalView["block"]>;
const SIZE = 320;

/** A place's mark: its shape says its kind (with a legend in words), never color alone. */
function Mark({ kind, x, y, used, selected }: { kind: PlaceView["kind"]; x: number; y: number; used: boolean; selected: boolean }) {
  const r = selected ? 7 : 5.5;
  const fill = used || selected ? "var(--color-ink)" : "var(--color-surface)";
  const common = { fill, stroke: "var(--color-ink)", strokeWidth: 1.6 };
  if (kind === "venue") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={1.5} {...common} />;
  if (kind === "park") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...common} />;
  if (kind === "shop") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

const LEGEND: { kind: PlaceView["kind"]; label: string }[] = [
  { kind: "food", label: "Food" },
  { kind: "venue", label: "Venue" },
  { kind: "park", label: "Park" },
  { kind: "shop", label: "Shop" },
];

/**
 * The block, small and calm: the store (or the event place) at the center, rings at 5 and 10
 * minutes' walk and the search radius, and a mark per Qloo place (shape by kind; filled when the
 * plan uses it). Tap a mark for its name, distance, Qloo's "why" and how the plan uses it. Without
 * Qloo coordinates it draws distance only, on a line: a direction is never invented. Plain SVG: no
 * map library, no tiles.
 */
export function BlockMap({ block, uses, compact = false }: { block: Block; uses: Readonly<Record<string, readonly string[]>>; compact?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const mode = mapMode(block.places);
  const chosen = block.places.find((p) => p.id === selected) ?? null;
  const points = new Map(projectPlaces(block.center, block.radiusM, block.places, SIZE).map((p) => [p.id, p]));
  const unplaced = mode === "map" ? block.places.filter((p) => !points.has(p.id)) : [];
  const press = (id: string) => setSelected((s) => (s === id ? null : id));

  return (
    <figure className="flex flex-col gap-3">
      {mode === "map" ? (
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={`Places around the ${block.center.label.toLowerCase()}`} className={cn("mx-auto w-full", compact ? "max-w-60" : "max-w-80")}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={ringRadius(block.radiusM, block.radiusM, SIZE)} fill="var(--color-paper-raised)" stroke="var(--color-hairline)" />
          {WALK_RINGS.filter((ring) => ring.meters < block.radiusM).map((ring) => {
            const r = ringRadius(ring.meters, block.radiusM, SIZE);
            return (
              <g key={ring.meters}>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={r} fill="none" stroke="var(--color-concrete-line)" strokeDasharray="3 4" strokeWidth={1} />
                <text x={SIZE / 2 + 3} y={SIZE / 2 - r - 3} className="fill-ink-soft font-mono text-[9px]">
                  {ring.label}
                </text>
              </g>
            );
          })}
          <rect x={SIZE / 2 - 6} y={SIZE / 2 - 6} width={12} height={12} fill="var(--color-brick)" stroke="var(--color-ink)" strokeWidth={1.6} transform={`rotate(45 ${SIZE / 2} ${SIZE / 2})`} />
          <text x={SIZE / 2 + 10} y={SIZE / 2 + 14} className="fill-ink text-[10px] font-semibold">
            {block.center.label}
          </text>
          {block.places.map((p) => {
            const pt = points.get(p.id);
            if (!pt) return null;
            return (
              <g key={p.id} role="button" tabIndex={0} aria-label={`${p.name}, ${p.kindLabel}${p.distanceText ? `, ${p.distanceText}` : ""}`} aria-pressed={selected === p.id} onClick={() => press(p.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), press(p.id))} className="cursor-pointer outline-none focus-visible:[&>*:first-child]:stroke-dusk">
                <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                <Mark kind={p.kind} x={pt.x} y={pt.y} used={Boolean(uses[p.id])} selected={selected === p.id} />
              </g>
            );
          })}
        </svg>
      ) : (
        <Strip block={block} uses={uses} selected={selected} onPress={press} compact={compact} />
      )}
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
        {LEGEND.filter((l) => block.places.some((p) => p.kind === l.kind)).map((l) => (
          <span key={l.kind} className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
              <Mark kind={l.kind} x={8} y={8} used={false} selected={false} />
            </svg>
            {l.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
            <circle cx={8} cy={8} r={5.5} fill="var(--color-ink)" />
          </svg>
          In the plan
        </span>
        {mode === "strip" && <span>Distance only</span>}
      </figcaption>
      <div aria-live="polite">
        {chosen && (
          <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-surface p-3 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">{chosen.name}</span>
              <span className="text-xs text-ink-soft">{chosen.kindLabel}</span>
              {chosen.distanceText && <span className="font-mono text-xs text-ink-soft">{chosen.distanceText}</span>}
            </p>
            {uses[chosen.id] && <p className="text-xs font-semibold">In the plan: {uses[chosen.id]!.join(", ")}</p>}
            {chosen.why && <p className="text-pretty text-ink-soft">{chosen.why}</p>}
            <ReceiptLink receiptKey={chosen.receipt} label="Why Qloo picked this" context={chosen.name} />
          </div>
        )}
      </div>
      {unplaced.length > 0 && <p className="text-xs text-ink-soft">Not on the map: {unplaced.map((p) => p.name).join(", ")}</p>}
    </figure>
  );
}

const ROWS: { kind: PlaceView["kind"]; label: string }[] = [
  { kind: "food", label: "Food" },
  { kind: "venue", label: "Venue" },
  { kind: "park", label: "Park" },
  { kind: "shop", label: "Shop" },
  { kind: "other", label: "Other" },
];

/** Distance only: one row per kind, the store at the left, the search radius at the right. */
function Strip({ block, uses, selected, onPress, compact }: { block: Block; uses: Readonly<Record<string, readonly string[]>>; selected: string | null; onPress: (id: string) => void; compact?: boolean }) {
  const W = 300;
  const L = 44;
  const rows = ROWS.filter((r) => block.places.some((p) => p.kind === r.kind && p.distanceM !== null));
  const H = rows.length * 28 + 26;
  return (
    <svg viewBox={`0 0 ${L + W + 12} ${H}`} role="group" aria-label={`Places by distance from the ${block.center.label.toLowerCase()}`} className={cn("w-full", compact ? "max-w-md" : "max-w-xl")}>
      {WALK_RINGS.filter((ring) => ring.meters < block.radiusM).map((ring) => (
        <g key={ring.meters}>
          <line x1={L + stripX(ring.meters, block.radiusM, W)} x2={L + stripX(ring.meters, block.radiusM, W)} y1={4} y2={H - 16} stroke="var(--color-concrete-line)" strokeDasharray="3 4" />
          <text x={L + stripX(ring.meters, block.radiusM, W)} y={H - 4} textAnchor="middle" className="fill-ink-soft font-mono text-[9px]">
            {ring.label}
          </text>
        </g>
      ))}
      <text x={L} y={H - 4} textAnchor="middle" className="fill-ink text-[9px] font-semibold">
        {block.center.label}
      </text>
      <text x={L + W} y={H - 4} textAnchor="end" className="fill-ink-soft font-mono text-[9px]">
        {block.radiusText}
      </text>
      {rows.map((row, i) => {
        const y = 16 + i * 28;
        return (
          <g key={row.kind}>
            <text x={0} y={y + 3} className="fill-ink-soft text-[10px]">
              {row.label}
            </text>
            <line x1={L} x2={L + W} y1={y} y2={y} stroke="var(--color-hairline)" />
            {block.places
              .filter((p) => p.kind === row.kind && p.distanceM !== null)
              .map((p) => {
                const x = L + stripX(p.distanceM!, block.radiusM, W);
                return (
                  <g key={p.id} role="button" tabIndex={0} aria-label={`${p.name}, ${p.kindLabel}${p.distanceText ? `, ${p.distanceText}` : ""}`} aria-pressed={selected === p.id} onClick={() => onPress(p.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPress(p.id))} className="cursor-pointer outline-none focus-visible:[&>*:first-child]:stroke-dusk">
                    <circle cx={x} cy={y} r={12} fill="transparent" />
                    <Mark kind={p.kind} x={x} y={y} used={Boolean(uses[p.id])} selected={selected === p.id} />
                  </g>
                );
              })}
          </g>
        );
      })}
    </svg>
  );
}
