import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Report } from "../schema";
import { formatDate, plainType, skewText } from "./format";
import { ledgerOf, panelNoun, panelText, rankText, receiptView, receiptWithSources, sourceRows } from "./receipts";
import { describeRecorded, ifRecorded } from "../../testing/recorded";

const report = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.report.json", "utf8")) as Report);
const ledger = ifRecorded(() => ledgerOf(report));

describeRecorded("receipts", () => {
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

describeRecorded("panel positions and Qloo picks in receipts", () => {
  const world = report.worlds[0];
  const music = world.culture!.find((f) => f.field === "music")!;

  it("says where a pick lands against its panel, never as a percentile, and claims no median under 5", () => {
    expect(panelText({ beats: 23, of: 25, aboveMedian: true }, "artists")).toBe("beats 23 of 25 reference artists");
    expect(panelText({ beats: 3, of: 4, aboveMedian: null }, "music tags")).toBe("beats 3 of 4 reference music tags (too few for a median)");
    expect([panelNoun("urn:entity:tv_show"), panelNoun("urn:tag:genre:music"), panelNoun("urn:tag:emotional_tone:qloo"), panelNoun("urn:tag:keyword:qloo"), panelNoun("urn:entity:destination")]).toEqual([
      "TV shows",
      "music tags",
      "mood tags",
      "tags",
      "destinations",
    ]);
  });

  it("lists each Qloo pick with its type, its rank in its own response and its panel position, then the calls", () => {
    const rows = sourceRows(music.sources);
    const first = music.sources[0];
    expect(rows[0]).toEqual({ label: "Qloo pick 1", value: `${first.name} (${plainType(first.type)}, #${first.rank} in its response, beats ${first.position!.beats} of ${first.position!.of} reference artists)` });
    const places = world.culture!.find((f) => f.field === "setting")!.sources;
    const placeRows = sourceRows(places);
    expect(placeRows[0].value).toMatch(/no reference panel for this type\)$/);
    expect(placeRows[1]).toEqual({ label: "Why", value: places[0].why.join("; ") });
    const receipt = receiptWithSources(ledger, music.cues[0].evidenceIds, music.sources, "Music feel", music.cues[0].text)!;
    expect(receipt.rows.slice(0, rows.length)).toEqual(rows);
    expect(receipt.calls).toBe(new Set(music.cues[0].evidenceIds).size);
    expect(receiptWithSources(ledger, [], music.sources, "x", "x")).toBeNull();
    expect(rankText(4)).toBe("#4 in its response");
  });
});
