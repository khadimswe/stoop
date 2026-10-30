import type { MapPin } from "@/lib/marketing/landing-stores";

const W = 400;
const H = 300;
const R = 132;

/**
 * The community as a plain drawing, for pages read without JavaScript (the real map needs it): the
 * dashed ring, the store's pill and the same numbered pins, placed from Qloo's own coordinates.
 * Places next door sit under the store's pill, as on the map.
 */
export function CommunityPlot({ center, radiusM, pins, label }: { center: { lat: number; lon: number; label: string }; radiusM: number; pins: readonly MapPin[]; label: string }) {
  const scale = R / radiusM;
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  const placed = pins
    .filter((p) => p.point && (p.distanceM === null || p.distanceM >= 120))
    .map((p) => ({ ...p, x: W / 2 + (p.point!.lon - center.lon) * kx * scale, y: H / 2 - (p.point!.lat - center.lat) * 110_540 * scale }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="size-full bg-[#efeeea]" preserveAspectRatio="xMidYMid slice">
      <circle cx={W / 2} cy={H / 2} r={R} fill="none" stroke="#141416" strokeOpacity="0.45" strokeWidth="1.2" strokeDasharray="4 4" />
      {placed.map((p) => (
        <g key={p.id}>
          <circle cx={p.x} cy={p.y} r="9" fill={p.used ? "#141416" : "#ffffff"} stroke="#141416" strokeWidth="1.5" />
          <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={p.used ? "#ffffff" : "#141416"} fontFamily="system-ui, sans-serif">
            {p.n}
          </text>
        </g>
      ))}
      <g>
        <rect x={W / 2 - 8} y={H / 2 - 13} width="92" height="26" rx="8" fill="#141416" stroke="#ffffff" strokeWidth="2" />
        <rect x={W / 2} y={H / 2 - 5} width="10" height="10" rx="2.5" fill="#c8f03c" />
        <text x={W / 2 + 16} y={H / 2 + 4} fontSize="11" fontWeight="600" fill="#ffffff" fontFamily="system-ui, sans-serif">
          {center.label}
        </text>
      </g>
    </svg>
  );
}
