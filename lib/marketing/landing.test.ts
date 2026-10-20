import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../demo/examples";
import { ledgerOf } from "../report/view/receipts";
import type { Report } from "../report/schema";
import {
  ageSkewMini,
  agentDemoStill,
  brandSaidLine,
  cueReceipt,
  realityCard,
  receiptLine,
  replayView,
  scoreboardRow,
  screeningPreview,
  shelfItem,
  sourceLine,
  teaserView,
  toBrandVoice,
} from "./landing";
import { describeRecorded } from "../testing/recorded";

const read = (slug: string) => JSON.parse(readFileSync(`data/runs/${slug}/run.report.json`, "utf8")) as Report;
const DASH = String.fromCharCode(0x2014);
const BANNED = new RegExp(`real buyers|really buys|measures your buyers|find my buyers|andromeda|24 and younger|24_and_younger|${DASH}`, "i");

describe("the landing's third-person voice", () => {
  it("moves only the fixed founder phrases to the brand", () => {
    expect(toBrandVoice("You said 25 to 40.")).toBe("This brand said 25 to 40.");
    expect(toBrandVoice("Read from your site: it speaks to 25 to 34, female.")).toBe("Read from the brand's site: it speaks to 25 to 34, female.");
    expect(toBrandVoice("What you didn't say: it skews female.")).toBe("What the brand didn't say: it skews female.");
    expect(toBrandVoice("Your band (25 to 54) is broad, so a match says little.")).toBe("The brand's band (25 to 54) is broad, so a match says little.");
    expect(toBrandVoice("Near tie on taste: your folk beats 18 of 19 reference tags.")).toBe("Near tie on taste: the brand's folk beats 18 of 19 reference tags.");
    expect(toBrandVoice("Your read is right: Qloo measures the same age.")).toBe("Their read is right: Qloo measures the same age.");
    expect(toBrandVoice("Near tie on age: Qloo's top skew, 18 to 24 (0.22), is only 0.03 ahead of the band you stated (25 to 40), so it isn't a gap.")).toBe(
      "Near tie on age: Qloo's top skew, 18 to 24 (0.22), is only 0.03 ahead of the band the brand stated (25 to 40), so it isn't a gap.",
    );
    const measured = "Qloo measured a taste neighborhood that skews 55 and older, into rock and folk.";
    expect(toBrandVoice(measured)).toBe(measured);
  });

  it("quotes the founder's own words", () => {
    expect(brandSaidLine(" Home cooks, 25 to 40. ")).toBe("This brand said: “Home cooks, 25 to 40.”");
  });
});

describeRecorded.each(EXAMPLES.map((e) => e.slug))("the landing views for %s", (slug) => {
  const report = read(slug);
  const ledger = ledgerOf(report);
  const gap = report.audience.gap!;

  it("builds the Reality Check card from the founder's words and the gap stage's own lines", () => {
    const card = realityCard(slug, report)!;
    expect(card).toMatchObject({ slug, brand: report.inputs.product.brandName, product: report.inputs.product.name, provenance: "recorded", outcome: gap.outcome });
    expect(card.lines[0]).toEqual({ kind: "said", text: brandSaidLine(report.inputs.statedCustomer!), source: "brand", receipt: null });
    // Every gap line but "You said" is kept, in order and verbatim (apart from the voice).
    const rest = gap.lines.filter((l) => l.kind !== "stated");
    expect(card.lines.slice(1).map((l) => [l.kind, l.text])).toEqual(rest.map((l) => [l.kind, toBrandVoice(l.text)]));
    const measured = card.lines.find((l) => l.kind === "measured")!;
    expect(measured.source).toBe("qloo");
    expect(measured.receipt?.calls).toBe(new Set(gap.lines.find((l) => l.kind === "measured")!.evidenceIds).size);
    // The generic line is the LLM-only brief: never a Qloo source, never a receipt.
    expect(card.lines.find((l) => l.kind === "generic")).toMatchObject({ source: "generic", receipt: null });
    expect(card.receiptLine).toMatch(/^\/v2\/insights · .*urn:demographics.* · 3 Qloo calls$/);
    for (const line of card.lines) {
      expect(line.text).not.toMatch(BANNED);
      // The landing speaks about the brand, never to it.
      expect(line.text).not.toMatch(/\byour?\b/i);
    }
  });

  it("keeps a near tie a near tie", () => {
    const card = realityCard(slug, report)!;
    const near = card.lines.find((l) => l.kind === "near");
    if (gap.outcome === "partly") {
      expect(near?.text).toMatch(/^Near tie/);
      expect(near?.text).toContain("isn't a gap");
    } else {
      expect(near).toBeUndefined();
    }
  });

  it("opens each world's music, setting and wardrobe receipts with ranks, panel positions and the Qloo calls", () => {
    const preview = screeningPreview(slug, report, null);
    expect(preview.href).toBe(`/examples/${slug}`);
    expect(preview.screening.worlds.map((w) => w.segmentId)).toEqual(report.worlds.map((w) => w.segmentId));
    for (const world of report.worlds) {
      const cues = preview.cues[world.segmentId];
      expect(cues[0]?.field).toBe("music");
      for (const { receipt, field } of cues) {
        const result = world.culture!.find((f) => f.field === field)!;
        expect(receipt.title).toBe(result.cues.find((c) => c.origin === "qloo" || c.origin === "interpreted")!.text);
        expect(receipt.rows.filter((r) => r.label === "Source")).toHaveLength(Math.min(3, result.sources.length));
        expect(receipt.rows.some((r) => r.label === "Endpoint" && r.value === "/v2/insights")).toBe(true);
        expect(receipt.note).toContain("never in prompts");
      }
    }
  });

  it("shelves each example with its verbatim lines and its worlds", () => {
    const item = shelfItem(slug, report);
    expect(item.href).toBe(`/examples/${slug}`);
    expect(item.measured).toBe(gap.lines.find((l) => l.kind === "measured")!.text);
    expect(item.generic).toBe(gap.lines.find((l) => l.kind === "generic")!.text);
    expect(item.receiptLine).toMatch(/· 3 Qloo calls$/);
    // A near tie is a Qloo fact too: it carries its own receipt line.
    if (item.near) expect(item.nearReceiptLine).toMatch(/^\/v2\/insights · urn:demographics · 1 Qloo call$/);
    else expect(item.nearReceiptLine).toBeNull();
    expect(item.worlds.map((w) => w.label)).toEqual(report.worlds.map((w) => w.label));
    expect(item.headline).toBe(report.comparison!.headline);
  });

  it("folds the recorded trace into the five steps, in pipeline order, with real call counts", () => {
    const replay = replayView(report);
    expect(replay.steps.map((s) => s.id)).toEqual(["prove", "gap", "segments", "culture", "pack"]);
    expect(replay.steps[2].title).toBe(`${report.worlds.length} concept worlds`);
    const tools = report.trace.filter((t) => t.kind === "tool");
    expect(replay.calls).toBe(tools.length);
    expect(replay.steps.reduce((sum, s) => sum + s.calls, 0)).toBe(tools.length);
    // Recorded runs replay every call from the recording.
    expect(replay.cached).toBe(replay.calls);
    // The trace's own labels, in the landing's third person.
    const labels = new Set(report.trace.map((t) => toBrandVoice(t.label)));
    for (const step of replay.steps) {
      expect(step.lines.length).toBeGreaterThan(0);
      expect(step.lines.length).toBeLessThanOrEqual(3);
      for (const line of step.lines) {
        expect(labels.has(line.label)).toBe(true);
        expect(`${line.label} ${line.reason ?? ""}`).not.toMatch(/\byour?\b/i);
      }
    }
  });

  it("teases one flagged cliche as the check wrote it, with its receipt", () => {
    const teaser = teaserView(slug, report)!;
    const world = report.worlds[0];
    expect(teaser.headline).toBe(report.comparison!.headline);
    expect(teaser.fitLine).toBe(report.control!.fits.find((f) => f.segmentId === world.segmentId)!.line);
    const cliche = world.check!.cliches.find((c) => c.assumed === teaser.cliche!.assumed)!;
    expect(teaser.cliche!.measured).toBe(cliche.measured);
    expect(teaser.cliche!.receipt.calls).toBe(new Set(cliche.evidenceIds).size);
  });

  it("puts the with-vs-without lines on the scoreboard verbatim", () => {
    const row = scoreboardRow(slug, report);
    expect(row.headline).toBe(report.comparison!.headline);
    expect(row.worlds.map((w) => w.control)).toEqual(report.comparison!.worlds.map((w) => w.control));
    expect(row.worlds.map((w) => w.label)).toEqual(report.worlds.map((w) => w.label));
    row.worlds.forEach((w, i) => expect(w.receipt?.calls).toBe(new Set(report.comparison!.worlds[i].evidenceIds).size));
  });

  it("names the calls behind a line, or nothing without evidence", () => {
    expect(receiptLine(ledger, [])).toBeNull();
    expect(receiptLine(ledger, ["ev_000000000000"])).toBeNull();
  });
});

describeRecorded("the lead example", () => {
  const report = read("food-hot-sauce");
  it("prefers the city cliche for the teaser", () => {
    expect(teaserView("food-hot-sauce", report)!.cliche).toMatchObject({ assumed: "A generic AI brief assumed Austin.", measured: "Qloo measured: Austin, TX ranks #37 of 329 cities for this world." });
  });

  it("writes a source with its rank and its panel position, never a percentile", () => {
    const artist = report.worlds[0].culture!.find((f) => f.field === "music")!.sources[0];
    expect(sourceLine(artist)).toBe(`${artist.name} (artist) · #4 in its response · beats 24 of 24 reference artists`);
    const place = report.worlds[0].culture!.find((f) => f.field === "setting")!.sources[0];
    expect(sourceLine(place)).toBe(`${place.name} (place) · #1 in its response · why: Fans of Tabasco and Hot Ones`);
    expect(cueReceipt(report.worlds[0], "music", ledgerOf(report))?.rows[1]).toEqual({ label: "Origin", value: "From Qloo: plain wording of the Qloo results below" });
  });

  it("keeps the open receipt short: the cue and its sources, then one line for the calls", () => {
    const { summary, receipt } = screeningPreview("food-hot-sauce", report, null).cues["seg-55-and-older"][0];
    expect(receipt.calls).toBe(4);
    expect(summary.rows.map((r) => r.label)).toEqual(["World", "Origin", "Signal", "Source", "Source", "Source", "Qloo calls"]);
    expect(summary.rows.at(-1)).toEqual({ label: "Qloo calls", value: "4 calls to /v2/insights, from cache, fetched Oct 16, 2026" });
    expect(summary.title).toBe(receipt.title);
  });
});

describeRecorded("the agent demo slot's still", () => {
  const report = read("food-hot-sauce");
  const still = agentDemoStill("food-hot-sauce", report);

  it("shows the lead run's measured line verbatim and its real Qloo call count", () => {
    expect(still.brand).toBe("Porchlight Pepper Co.");
    expect(still.date).toBe("Oct 16, 2026");
    expect(still.measured).toBe(report.audience.gap!.lines.find((l) => l.kind === "measured")!.text);
    // The measured line is a Qloo fact: it carries the calls behind it.
    expect(still.receiptLine).toBe("/v2/insights · urn:demographics, urn:tag, urn:heatmap · 3 Qloo calls");
    expect(still.calls).toBe(report.trace.filter((t) => t.kind === "tool").length);
    expect(still.calls).toBe(36);
    expect(still.cached).toBe(still.calls);
    expect(still.steps.map((s) => s.title)).toEqual(replayView(report).steps.map((s) => s.title));
    expect(still.steps.reduce((sum, s) => sum + s.calls, 0)).toBe(still.calls);
  });
});

describeRecorded("the step card's age chart", () => {
  it("draws every bucket's skew from Qloo's demographics, adults only, with the top skew marked", () => {
    const report = read("food-hot-sauce");
    const mini = ageSkewMini(report)!;
    expect(mini.bars.map((b) => b.label)).toEqual(["18 to 24", "25 to 29", "30 to 34", "35 to 44", "45 to 54", "55 and older"]);
    expect(mini.bars.filter((b) => b.top).map((b) => b.label)).toEqual(["55 and older"]);
    expect(mini.bars.at(-1)).toMatchObject({ text: "skews +0.21", value: 21 });
    expect(mini.bars[4]).toMatchObject({ text: "skews -0.37", value: -37 });
    expect(mini.summary).toBe("Porchlight Pepper Co.'s age skews from Qloo: highest for 55 and older (skews +0.21).");
    expect(mini.receiptLine).toBe("/v2/insights · urn:demographics · 1 Qloo call");
    for (const bar of mini.bars) expect(bar.text).not.toMatch(BANNED);
  });
});
