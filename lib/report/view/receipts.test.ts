import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../schema";
import { formatDate, plainType, skewText } from "./format";
import { ledgerOf, receiptView } from "./receipts";

const report = JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report;
const ledger = ledgerOf(report);

describe("receipts", () => {
  it("shows the call, the exact query and when Qloo served it", () => {
    const entry = report.ledger[0];
    const receipt = receiptView(ledger, [entry.id], "Music style", "Roots rock")!;
    expect(receipt).toMatchObject({ cue: "Music style", title: "Roots rock", calls: 1 });
    const rows = Object.fromEntries(receipt.rows.map((r) => [r.label, r.value]));
    expect(rows.Endpoint).toBe(entry.endpoint);
    expect(rows.Query).toBe(Object.entries(entry.params).map(([k, v]) => `${k}=${v}`).join("&"));
    expect(rows.Served).toBe(`${entry.cached ? "From cache, fetched" : "Fetched from Qloo"} ${formatDate(entry.fetchedAt)}`);
    for (const row of receipt.rows) expect(row.value).not.toMatch(/api[-_ ]?key/i);
  });

  it("numbers several calls, drops duplicates and unknown ids, and gives no receipt without evidence", () => {
    const [a, b] = report.ledger;
    const receipt = receiptView(ledger, [a.id, b.id, a.id, "ev_000000000000"], "Reality Check", "x")!;
    expect(receipt.calls).toBe(2);
    expect(receipt.rows.filter((r) => r.label.startsWith("Call ")).map((r) => r.label)).toEqual(["Call 1 of 2", "Call 2 of 2"]);
    expect(receiptView(ledger, [], "x", "x")).toBeNull();
    expect(receiptView(ledger, ["ev_000000000000"], "x", "x")).toBeNull();
  });
});

describe("formatters", () => {
  it("prints skews as signed indices, never shares", () => {
    expect(skewText(0.2075)).toBe("skews +0.21");
    expect(skewText(-0.18)).toBe("skews -0.18");
    expect(skewText(0.001)).toBe("skews 0.00");
  });

  it("names Qloo types in plain words and dates in UTC", () => {
    expect(plainType("urn:entity:tv_show")).toBe("tv show");
    expect(plainType("urn:entity:brand")).toBe("brand");
    expect(plainType("urn:tag:genre:music")).toBe("tag");
    expect(formatDate("2026-10-16T23:30:00.000Z")).toBe("Oct 16, 2026");
  });
});
