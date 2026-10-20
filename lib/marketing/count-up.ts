// The landing's big numbers, as parts: text that stays put and whole numbers that count up from 0 once
// when the figure scrolls into view. The final figure is what the server renders, so a page without
// JavaScript, or with reduced motion, shows the recorded value and nothing else.

/** One piece of a figure. `lg` parts are the giant digits; `sm` parts sit beside them, smaller. */
export type FigurePart = { kind: "text"; text: string; size: "lg" | "sm" } | { kind: "number"; value: number; size: "lg" | "sm" };

/** How long one count takes. It runs once and never loops. */
export const COUNT_UP_MS = 1100;

const clamp01 = (t: number) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1);

/** Fast at first, settling on the value: the count slows into the recorded number. */
export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}

/** Each part's text at a point in the count (0 to 1, eased). At 1, every number is exactly its value. */
export function figurePartsAt(parts: readonly FigurePart[], progress: number): string[] {
  const eased = easeOutCubic(progress);
  return parts.map((part) => (part.kind === "text" ? part.text : String(eased >= 1 ? part.value : Math.round(part.value * eased))));
}

/** The figure as it ends, in one string: "#319 of 321". */
export function figureText(parts: readonly FigurePart[]): string {
  return figurePartsAt(parts, 1).join("");
}

export const text = (value: string, size: FigurePart["size"] = "lg"): FigurePart => ({ kind: "text", text: value, size });
export const num = (value: number, size: FigurePart["size"] = "lg"): FigurePart => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`A counted figure is a whole number from 0 up, got ${value}`);
  return { kind: "number", value, size };
};
