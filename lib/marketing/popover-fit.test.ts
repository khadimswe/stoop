import { describe, expect, it } from "vitest";
import { popoverShift } from "./popover-fit";

// Measured at 1440 x 900: the Reserve popover is about 508 px tall, its button 44 px.
const base = { viewport: 900, height: 508, offset: 10, padding: 12 };

describe("where pricing's Reserve popover fits", () => {
  it("leaves the page alone when the popover fits above or below the button", () => {
    expect(popoverShift({ ...base, top: 700, bottom: 744 })).toBe(0);
    expect(popoverShift({ ...base, top: 120, bottom: 164 })).toBe(0);
  });

  it("scrolls a mid-screen button down until the whole popover fits above it", () => {
    const shift = popoverShift({ ...base, top: 428, bottom: 472 });
    expect(shift).toBe(530 - 428);
    // After the scroll, the room above is exactly the popover plus its offset and padding, and the button is still on screen.
    expect(428 + shift).toBe(base.height + base.offset + base.padding);
    expect(472 + shift).toBeLessThanOrEqual(base.viewport - base.padding);
  });

  it("on a viewport too short for both, keeps the button on screen and lets the popover scroll inside", () => {
    const short = { ...base, viewport: 560 };
    const shift = popoverShift({ ...short, top: 260, bottom: 304 });
    expect(304 + shift).toBe(short.viewport - short.padding);
    // Already at the bottom edge: nothing to gain.
    expect(popoverShift({ ...short, top: 504, bottom: 548 })).toBe(0);
  });
});
