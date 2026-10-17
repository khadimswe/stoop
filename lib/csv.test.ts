import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("passes plain values through and empties null", () => {
    expect(csvCell("ana@shop.example")).toBe("ana@shop.example");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("guards every cell that a spreadsheet would run as a formula", () => {
    for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
      const cell = csvCell(`${start}HYPERLINK("https://evil.example")`);
      expect(cell.startsWith(`"'${start}`)).toBe(true);
    }
    expect(csvCell("=1+1")).toBe(`"'=1+1"`);
    expect(csvCell("-5")).toBe(`"'-5"`);
  });

  it("quotes cells with commas, quotes or line breaks, doubling inner quotes", () => {
    expect(csvCell("a,b")).toBe(`"a,b"`);
    expect(csvCell('say "hi"')).toBe(`"say ""hi"""`);
    expect(csvCell("two\nlines")).toBe(`"two\nlines"`);
    expect(csvCell('=cmd|" /C calc"!A0')).toBe(`"'=cmd|"" /C calc""!A0"`);
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and ends with one", () => {
    expect(toCsv([["position", "email"], [1, "ana@shop.example"], [2, "=evil"]])).toBe(`position,email\r\n1,ana@shop.example\r\n2,"'=evil"\r\n`);
  });
});
