import { describe, expect, it } from "vitest";
import { easeOutCubic, figurePartsAt, figureText, num, text } from "./count-up";

const RANK = [text("#"), num(319, { from: 1 }), text(" of 321", "sm")];

describe("the count-up figure", () => {
  it("ends exactly on the recorded value", () => {
    expect(figureText(RANK)).toBe("#319 of 321");
    expect(figurePartsAt(RANK, 1)).toEqual(["#", "319", " of 321"]);
  });

  it("starts every number on its floor and keeps the words in place", () => {
    expect(figurePartsAt(RANK, 0)).toEqual(["#", "1", " of 321"]);
    expect(figurePartsAt([num(0), text(" of 19", "sm")], 0.5)).toEqual(["0", " of 19"]);
    expect(figurePartsAt([num(55, { from: 18 }), text("+")], 0)).toEqual(["18", "+"]);
  });

  it("only ever counts up, in whole numbers, never under its floor or past its value", () => {
    let last = 18;
    for (let i = 0; i <= 40; i++) {
      const [value] = figurePartsAt([num(55, { from: 18 })], i / 40).map(Number);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(last);
      expect(value).toBeLessThanOrEqual(55);
      last = value;
    }
    expect(last).toBe(55);
  });

  it("clamps progress, so a late frame or a bad clock still lands on the value", () => {
    expect(figurePartsAt([num(24)], 1.7)).toEqual(["24"]);
    expect(figurePartsAt([num(24)], -1)).toEqual(["0"]);
    expect(figurePartsAt([num(24)], Number.NaN)).toEqual(["24"]);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("refuses a figure it cannot count", () => {
    expect(() => num(-3)).toThrow();
    expect(() => num(2.5)).toThrow();
    expect(() => num(10, { from: 18 })).toThrow();
  });
});
