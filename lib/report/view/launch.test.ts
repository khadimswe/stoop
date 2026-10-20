import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../demo/examples";
import { CONTROL_KEY } from "../../demo/manifest";
import { ageBandLabel } from "../../types";
import type { Report } from "../schema";
import { skewText } from "./format";
import {
  CONTROL_CELL_KEY,
  CONTROL_CELL_LABEL,
  CONTROL_WATCH,
  INTEREST_TYPES,
  LAUNCH_MAX_INTERESTS,
  LAUNCH_PLACEMENTS,
  launchPlanView,
  type LaunchCellView,
  type LaunchPlanView,
} from "./launch";
import {
  ACCOUNT_NOTE,
  BUDGET_DEFAULTS,
  callLine,
  CONTROL_INTEREST_NOTE,
  INTEREST_NOTE,
  formatUsd,
  LAUNCH_SHEET_COLUMNS,
  launchSheetCsv,
  launchSheetMarkdown,
  launchSheetRows,
  leftoverLine,
  paceLine,
  parseCents,
  PILOT_NOTE,
  planBudget,
  splitLine,
  type BudgetSplit,
} from "./launch-sheet";
import { ledgerOf } from "./receipts";
import { describeRecorded } from "../../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;

/** Parses the CSV this module writes (RFC 4180 quoting, CRLF rows), so tests read cells back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

function split(cells: number, daily = BUDGET_DEFAULTS.daily, days = BUDGET_DEFAULTS.days, target = BUDGET_DEFAULTS.target): BudgetSplit {
  const result = planBudget({ daily, days, target }, cells);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.split;
}

/** Every string a cell shows, receipts left out (their query rows are Qloo's own parameters). */
function cellText(cell: LaunchCellView): string {
  const { ageBands, cities, interests, ...rest } = cell;
  return JSON.stringify([rest, [...ageBands, ...cities].map((o) => [o.text, o.detail]), interests.map((i) => [i.name, i.kind])]);
}

describeRecorded.each(EXAMPLES.map((e) => e.slug))("the Launch plan for %s", (slug) => {
  const report = read(slug);
  const ledger = ledgerOf(report);
  const view = launchPlanView(report);
  const segments = new Map(report.audience.segments!.items.map((s) => [s.id, s]));

  it("has the Control as the baseline cell, then one cell per concept world in segment order", () => {
    expect(view.unavailable).toBeNull();
    expect(view.skipped).toEqual([]);
    expect(view.cells.map((c) => [c.key, c.kind, c.name])).toEqual([
      [CONTROL_CELL_KEY, "control", "Control"],
      ...report.worlds.map((w, i) => [w.segmentId, "world", `World ${i + 1}`]),
    ]);
    expect(view.brand).toBe(report.inputs.product.brandName);
    expect(view.campaign).toBe(`${report.inputs.product.brandName} · concept world test`);
    expect(view.fileName).toMatch(/^[a-z0-9-]+-launch-sheet\.csv$/);
  });

  it("gives every cell its kept concept, the anchor of its Output card and the placements", () => {
    const [control, ...worlds] = view.cells;
    expect(control.creative).toEqual({ title: report.control!.pack!.concept.title, hook: report.control!.pack!.concept.hook, anchor: "output-control" });
    worlds.forEach((cell, i) => {
      const { concept } = report.worlds[i].pack!;
      expect(cell.creative).toEqual({ title: concept.title, hook: concept.hook, anchor: `output-${report.worlds[i].segmentId}` });
      expect(cell.label).toBe(report.worlds[i].label);
      expect(cell.adSetName).toBe(`World ${i + 1} · ${report.worlds[i].label}`);
    });
    for (const cell of view.cells) expect(cell.placements).toEqual([...LAUNCH_PLACEMENTS]);
  });

  it("shows each world's age bands and cities as Qloo facts, every one with a receipt from the ledger", () => {
    for (const [i, cell] of view.cells.slice(1).entries()) {
      const world = report.worlds[i];
      const plan = world.kit!.adPlan!;
      const segment = segments.get(world.segmentId)!;
      expect(cell.optionsFrom).toBe("qloo");
      expect(cell.ageBands.map((o) => o.text)).toEqual(plan.ageBands.map(ageBandLabel));
      expect(cell.ageBands[0].detail).toBe(skewText(segment.skew));
      expect(cell.cities.map((o) => o.text)).toEqual(plan.cities);
      for (const option of [...cell.ageBands, ...cell.cities]) {
        expect(option.receipt, option.text).not.toBeNull();
        expect(option.receipt!.calls).toBeGreaterThan(0);
        expect(option.receipt!.rows.some((r) => r.label === "Endpoint")).toBe(true);
        expect(option.evidenceIds.length).toBeGreaterThan(0);
        for (const id of option.evidenceIds) expect(ledger.has(id), id).toBe(true);
      }
      // The skew comes from the demographics call; each city from its own heatmap call.
      for (const id of cell.ageBands[0].evidenceIds) expect(ledger.get(id)!.params["filter.type"]).toBe("urn:demographics");
      cell.cities.forEach((option) => {
        const cue = segment.cities.find((c) => c.label === option.text)!;
        expect(option.evidenceIds).toEqual(cue.evidenceIds);
        expect(option.detail).toBe(`#${cue.rank} by lift`);
        expect(option.receipt!.title).toBe(`${cue.label}: #${cue.rank} of this world's cities by lift, ranked against ${cue.comparedWith} reference audiences`);
      });
      expect(cell.watch).toMatch(/^Watch.+ Compare its cost per result with the Control's\.$/);
    }
  });

  it("suggests up to 8 interest searches per world: only entities Qloo returned for that world, each with its receipt", () => {
    for (const [i, cell] of view.cells.slice(1).entries()) {
      const world = report.worlds[i];
      const sources = world.culture!.filter((f) => f.scope === "segment").flatMap((f) => f.sources);
      expect(cell.interests.length).toBeGreaterThan(0);
      expect(cell.interests.length).toBeLessThanOrEqual(LAUNCH_MAX_INTERESTS);
      expect(new Set(cell.interests.map((x) => x.id)).size).toBe(cell.interests.length);
      for (const interest of cell.interests) {
        const source = sources.find((s) => s.kind === "entity" && s.id === interest.id);
        expect(source, interest.name).toBeDefined();
        expect(interest).toMatchObject({ name: source!.name, rank: source!.rank });
        expect(INTEREST_TYPES as readonly string[]).toContain(source!.type);
        expect(interest.receipt.calls).toBeGreaterThan(0);
        expect(interest.receipt.cue).toBe("Interest search");
        expect(interest.evidenceIds).toEqual([...new Set(source!.evidenceIds)]);
        for (const id of interest.evidenceIds) expect(ledger.has(id), id).toBe(true);
      }
      // Each type keeps Qloo's rank order, and the types take turns.
      const kinds = [...new Set(cell.interests.map((x) => x.kind))];
      for (const kind of kinds) {
        const ranks = cell.interests.filter((x) => x.kind === kind).map((x) => x.rank);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      }
      expect(new Set(cell.interests.slice(0, kinds.length).map((x) => x.kind)).size).toBe(kinds.length);
      // No people or places, and the names never reach a video prompt.
      expect(cell.interests.map((x) => x.kind)).not.toContain("person");
      expect(cell.interests.map((x) => x.kind)).not.toContain("place");
      const prompts = JSON.stringify([world.pack!.renders.map((r) => r.prompt), world.pack!.assets.map((a) => a.prompt)]);
      for (const interest of cell.interests) expect(prompts, interest.name).not.toContain(interest.name);
    }
    expect(view.cells[0].interests).toEqual([]);
  });

  it("labels the Control's options as the generic brief's, never as Qloo's", () => {
    const control = view.cells[0];
    expect(control).toMatchObject({ label: CONTROL_CELL_LABEL, optionsFrom: "generic", watch: CONTROL_WATCH });
    expect(control.ageBands.map((o) => o.text)).toEqual(report.control!.assumed.ageBands.map(ageBandLabel));
    expect(control.cities.map((o) => o.text)).toEqual(report.control!.assumed.cities);
    for (const option of [...control.ageBands, ...control.cities]) expect(option).toMatchObject({ detail: null, receipt: null, evidenceIds: [] });
  });

  it("keeps to adult labels and makes no claims: no medians, percentiles, shares or promised results", () => {
    for (const cell of view.cells) {
      const text = cellText(cell);
      expect(text).not.toMatch(/24 and younger|24_and_younger/);
      expect(text).not.toMatch(/median|percentile|\d\s?%|guarantee|real buyers|really buys|andromeda/i);
    }
    expect(view.optionsNote).toBe(report.worlds[0].kit!.adPlan!.note);
  });

  it("writes one launch sheet row per cell, with a BOM, the budget split and the receipts", () => {
    const s = split(view.cells.length);
    const csv = launchSheetCsv(view, s, "https://stoop.example/examples/x#ignored");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]).toEqual([...LAUNCH_SHEET_COLUMNS]);
    expect(rows).toHaveLength(view.cells.length + 1);
    const col = (name: (typeof LAUNCH_SHEET_COLUMNS)[number]) => LAUNCH_SHEET_COLUMNS.indexOf(name);
    view.cells.forEach((cell, i) => {
      const row = rows[i + 1];
      expect(row[col("Campaign")]).toBe(view.campaign);
      expect(row[col("Ad set name")]).toBe(cell.adSetName);
      expect(row[col("Ad name")]).toBe(cell.creative.title);
      expect(row[col("Daily budget (USD)")]).toBe("20");
      expect(row[col("Placements")]).toBe("Meta Reels; Meta Stories; TikTok");
      expect(row[col("Cities")]).toBe(cell.cities.map((o) => o.text).join("; "));
      expect(row[col("Interest searches (suggestions)")]).toBe(cell.interests.map((x) => x.name).join("; "));
      if (cell.kind === "control") expect(row[col("Interest searches (suggestions)")]).toBe("");
      expect(row[col("Hook")]).toBe(cell.creative.hook);
      expect(row[col("Prompt reference")]).toBe(`https://stoop.example/examples/x#${cell.creative.anchor}`);
      expect(row[col("What to watch")]).toBe(cell.watch);
      expect(row[col("Audience options from")]).toBe(cell.kind === "control" ? "Generic AI brief, not from Qloo" : "Qloo taste data (optional)");
      expect(row[col("Qloo receipts")]).toBe(
        cell.kind === "control" ? "None: not from Qloo" : [...new Set([...cell.ageBands, ...cell.cities, ...cell.interests].flatMap((o) => o.evidenceIds))].join(" "),
      );
    });
  });

  it("copies the plan as Markdown: every cell, the rule relative to the Control and the pilot note", () => {
    const md = launchSheetMarkdown(view, split(view.cells.length, "60", "7", "25"));
    expect(md.startsWith(`# Launch plan: ${view.brand}`)).toBe(true);
    for (const cell of view.cells) expect(md).toContain(`## ${cell.name}: `);
    expect(md).toContain("Set it up in Ads Manager in about 10 minutes.");
    expect(md).toContain("1. Wait until each cell has spent at least $75, 3 times your $25 target cost per result. At $20 a day per cell, that takes at least 4 days.");
    expect(md).toContain("2. Keep the worlds whose cost per result beats the Control's.");
    expect(md).toContain("3. Pause the rest, and move their budget to the best world.");
    expect(md).toContain(PILOT_NOTE);
    expect(md).toContain(ACCOUNT_NOTE);
    expect(md).toContain("- Age bands (from the generic brief, not from Qloo): ");
    expect(md).toContain("- Age bands (Qloo, optional): ");
    expect(md).toContain(`- Interest searches to try in Ads Manager: ${CONTROL_INTEREST_NOTE}`);
    for (const cell of view.cells.slice(1)) {
      expect(md).toContain(`- Interest searches to try in Ads Manager (Qloo, suggestions): ${cell.interests[0].name.replace(/([\\`*_[\]<>|])/g, "\\$1")} (${cell.interests[0].kind})`);
    }
    expect(md).toContain(INTEREST_NOTE);
    expect(md).not.toMatch(/import(s|ed)? (it )?into Ads Manager/i);
  });
});

describeRecorded("the Launch plan when the test cannot run", () => {
  const base = read("food-hot-sauce");

  it("needs the Control: without it there is no baseline and no cells", () => {
    const report = structuredClone(base);
    report.control = null;
    const view = launchPlanView(report);
    expect(view.cells).toEqual([]);
    expect(view.unavailable).toMatch(/no generic Control/);
  });

  it("needs the Control's concept", () => {
    const report = structuredClone(base);
    report.control = { ...report.control!, concepts: null, pack: null, kit: null };
    expect(launchPlanView(report)).toMatchObject({ cells: [], unavailable: expect.stringMatching(/stopped before its concept/) });
  });

  it("leaves out a world that stopped before its concept, and says so", () => {
    const report = structuredClone(base);
    report.worlds[1] = { ...report.worlds[1], concepts: null, pack: null, kit: null, partial: { stage: "concepts", reason: "The concept writer timed out." } };
    const view = launchPlanView(report);
    expect(view.cells.map((c) => c.key)).toEqual([CONTROL_CELL_KEY, report.worlds[0].segmentId]);
    expect(view.skipped).toEqual([{ label: report.worlds[1].label, reason: "Stopped early: The concept writer timed out." }]);
    for (const world of report.worlds) world.concepts = world.pack = world.kit = null;
    expect(launchPlanView(report)).toMatchObject({ cells: [], unavailable: expect.stringMatching(/No concept world/) });
  });

  it("never shows a Qloo option whose receipt is not in the ledger", () => {
    const report = structuredClone(base);
    const segment = report.audience.segments!.items.find((s) => s.id === report.worlds[0].segmentId)!;
    const missing = "ev_000000000000";
    segment.cities[0].evidenceIds = [missing];
    const view = launchPlanView(report);
    const cell = view.cells.find((c) => c.key === segment.id)!;
    expect(cell.cities.map((o) => o.text)).not.toContain(segment.cities[0].label);
    expect(cell.cities.length).toBe(report.worlds[0].kit!.adPlan!.cities.length - 1);
  });

  it("falls back to the segment's own age band and cities when a world has no ad plan entry", () => {
    const report = structuredClone(base);
    report.worlds[0].kit = { ...report.worlds[0].kit!, adPlan: null };
    const segment = report.audience.segments!.items.find((s) => s.id === report.worlds[0].segmentId)!;
    const cell = launchPlanView(report).cells[1];
    expect(cell.ageBands.map((o) => o.text)).toEqual([segment.ageBand]);
    expect(cell.cities.map((o) => o.text)).toEqual(segment.cities.slice(0, 5).map((c) => c.label));
  });
});

describe("the budget helper", () => {
  it("splits the default $60 a day for 7 days evenly across 3 cells", () => {
    const s = split(3);
    expect(s).toMatchObject({ cells: 3, days: 7, perCellDailyCents: 2000, leftoverCents: 0, perCellTotalCents: 14000, totalCents: 42000, targetCents: null, callAtCents: null, callAfterDays: null });
    expect(splitLine(s)).toBe("$20 a day per cell · $140 per cell over 7 days · $420 in total");
    expect(leftoverLine(s)).toBeNull();
    expect(callLine(s)).toBe("Wait until the 7 test days are over.");
    expect(paceLine(s)).toBe("With a target cost per result, you can call it on spend instead.");
  });

  it("rounds each cell down to whole dollars and notes what stays unspent", () => {
    const s = split(3, "100");
    expect(s).toMatchObject({ perCellDailyCents: 3300, leftoverCents: 100, totalCents: 3300 * 3 * 7 });
    expect(leftoverLine(s)).toBe("$1 a day stays unspent, so every cell gets the same budget.");
    expect(split(3, "$60.50")).toMatchObject({ perCellDailyCents: 2000, leftoverCents: 50 });
    expect(leftoverLine(split(3, "60.5"))).toBe("$0.50 a day stays unspent, so every cell gets the same budget.");
    expect(split(4, "1,000", "14")).toMatchObject({ perCellDailyCents: 25000, leftoverCents: 0, perCellTotalCents: 350000, totalCents: 1400000 });
    expect(splitLine(split(4, "1,000", "14"))).toBe("$250 a day per cell · $3,500 per cell over 14 days · $14,000 in total");
    expect(callLine(split(3, "60", "1"))).toBe("Wait until the 1 test day is over.");
  });

  it("says when to call it from the target cost per result, and when that outlasts the test days", () => {
    const s = split(3, "60", "7", "25");
    expect(s).toMatchObject({ targetCents: 2500, callAtCents: 7500, callAfterDays: 4 });
    expect(callLine(s)).toBe("Wait until each cell has spent at least $75, 3 times your $25 target cost per result.");
    expect(paceLine(s)).toBe("At $20 a day per cell, that takes at least 4 days.");
    const long = split(3, "60", "7", "80.50");
    expect(long).toMatchObject({ callAtCents: 24150, callAfterDays: 13 });
    expect(paceLine(long)).toBe("At $20 a day per cell, that takes at least 13 days, longer than your 7 days: run the test longer or raise the budget.");
  });

  it("rejects what it cannot split, with a plain message per field", () => {
    const errors = (daily: string, days: string, target = "", cells = 3) => {
      const result = planBudget({ daily, days, target }, cells);
      return result.ok ? {} : result.errors;
    };
    expect(errors("", "7")).toEqual({ daily: "Enter a daily budget, like 60." });
    expect(errors("sixty", "7")).toEqual({ daily: "Enter a dollar amount, like 60 or 60.50." });
    expect(errors("-5", "7")).toEqual({ daily: "Enter a dollar amount, like 60 or 60.50." });
    expect(errors("2", "7")).toEqual({ daily: "Use at least $3 a day, so each of the 3 cells gets $1." });
    expect(errors("100001", "7")).toEqual({ daily: "Use $100,000 a day or less." });
    expect(errors("60", "")).toEqual({ days: "Enter the test days, like 7." });
    expect(errors("60", "2.5")).toEqual({ days: "Enter whole days, like 7." });
    expect(errors("60", "0")).toEqual({ days: "Use 1 to 90 days." });
    expect(errors("60", "91")).toEqual({ days: "Use 1 to 90 days." });
    expect(errors("60", "7", "abc")).toEqual({ target: "Enter a dollar amount, like 25, or leave it empty." });
    expect(errors("60", "7", "0")).toEqual({ target: "Use more than $0, or leave it empty." });
    expect(errors("60", "7", "100000.01")).toEqual({ target: "Use $100,000 or less." });
    expect(errors("x", "y", "z")).toMatchObject({ daily: expect.any(String), days: expect.any(String), target: expect.any(String) });
  });

  it("reads dollar amounts the way people type them, in cents", () => {
    expect(parseCents("60")).toBe(6000);
    expect(parseCents(" $60 ")).toBe(6000);
    expect(parseCents("$ 1,200.5")).toBe(120050);
    expect(parseCents("24.99")).toBe(2499);
    expect(parseCents("24.")).toBe(2400);
    for (const bad of ["", "1,00", "12.345", "1e3", "Infinity", "60 USD", "--1"]) expect(parseCents(bad), bad).toBeNull();
    expect(formatUsd(2000)).toBe("$20");
    expect(formatUsd(50)).toBe("$0.50");
    expect(formatUsd(140000)).toBe("$1,400");
  });
});

describeRecorded("the launch sheet's guards", () => {
  const view: LaunchPlanView = launchPlanView(read("food-hot-sauce"));
  const hostile = (hook: string): LaunchPlanView => ({ ...view, cells: view.cells.map((c, i) => (i === 0 ? { ...c, creative: { ...c.creative, hook } } : c)) });

  it("guards every cell that a spreadsheet would run as a formula", () => {
    for (const start of ["=", "+", "-", "@"]) {
      const csv = launchSheetCsv(hostile(`${start}HYPERLINK("https://evil.example","x")`), split(3));
      const rows = parseCsv(csv.slice(1));
      expect(rows[1][LAUNCH_SHEET_COLUMNS.indexOf("Hook")]).toBe(`'${start}HYPERLINK("https://evil.example","x")`);
    }
  });

  it("without a page URL, points to the Output section by name", () => {
    const rows = launchSheetRows(view, split(3));
    expect(rows.map((r) => r[LAUNCH_SHEET_COLUMNS.indexOf("Prompt reference")])).toEqual(["Output section, Control", ...view.cells.slice(1).map((c) => `Output section, ${c.label}`)]);
  });

  it("escapes Markdown markup in generated text", () => {
    const md = launchSheetMarkdown(hostile("Pour *slowly* <b>now</b> [x](y)"), split(3));
    expect(md).toContain("- Hook: Pour \\*slowly\\* \\<b\\>now\\</b\\> \\[x\\](y)");
  });

  it("names the file after the brand, and keys the Control like its Output card", () => {
    expect(launchPlanView(read("pets-outfits")).fileName).toBe("whisker-brim-launch-sheet.csv");
    expect(view.fileName).toBe("porchlight-pepper-co-launch-sheet.csv");
    expect(CONTROL_CELL_KEY).toBe(CONTROL_KEY);
  });
});
