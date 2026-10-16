import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, relativeLuminance } from "./contrast";

describe("contrast math", () => {
  it("parses short and long hex", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("1d1a2b")).toEqual([29, 26, 43]);
  });

  it("rejects non-hex input", () => {
    expect(() => hexToRgb("oklch(1 0 0)")).toThrow();
  });

  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#e8572e", "#1d1a2b")).toBeCloseTo(contrastRatio("#1d1a2b", "#e8572e"));
  });
});
