// Where a popover opened from mid-page fits: pricing's Reserve popover holds a whole form, taller
// than the room above or below a button in the middle of a laptop screen. Pure, so the client
// component only measures and scrolls.

export interface FitInput {
  /** The trigger's top and bottom, in viewport pixels. */
  top: number;
  bottom: number;
  /** The viewport's height. */
  viewport: number;
  /** The popover's full height, its offset from the trigger and the padding kept from the viewport's edges. */
  height: number;
  offset: number;
  padding: number;
}

/**
 * How far to scroll the page up (in pixels, 0 for not at all) so the popover opens above its trigger
 * with all of it on screen. 0 when it already fits above or below (the popover takes that side). When
 * the viewport is too short for the popover and the trigger together, it scrolls as far as keeps the
 * trigger on screen; the popover then scrolls inside.
 */
export function popoverShift({ top, bottom, viewport, height, offset, padding }: FitInput): number {
  const needed = height + offset + padding;
  if (top >= needed || viewport - bottom >= needed) return 0;
  const room = viewport - padding - bottom;
  return Math.max(0, Math.min(needed - top, room));
}
