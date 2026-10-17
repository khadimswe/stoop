// The golden test for full runs: every recorded example run (audience, concept worlds, the Control
// and the comparison) reduces to exactly its stored report, and replaying it from recorded Qloo and
// Claude answers reproduces both files byte for byte, with the network switched off. Plus what each
// world must show: Qloo-backed fields, wording with no real names, settings from the audience's own
// cities, and probes within budget.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recordExampleBrief, replayOptions } from "../demo/example-run";
import { EXAMPLES } from "../demo/examples";
import { reduce, toReport, type RunEvent } from "../events";
import { checkText } from "../guardrails";
import type { Report } from "../report/schema";
import { INTERIM_CREATIVE } from "./creative";
import { MAX_PROBES } from "./culture-agent";
import { compareWorlds } from "./orchestrator";

const read = <T>(slug: string, file: string) => JSON.parse(readFileSync(`data/runs/${slug}/${file}`, "utf8")) as T;
const stored = Object.fromEntries(EXAMPLES.map(({ slug }) => [slug, { events: read<RunEvent[]>(slug, "run.events.json"), report: read<Report>(slug, "run.report.json") }]));
// The same writer as scripts/run-example.ts: U+2014 in Qloo names is stored as an escape.
const asStored = (value: unknown) => `${JSON.stringify(value, null, 2).replace(new RegExp(String.fromCharCode(0x2014), "g"), "\\u2014")}\n`;

// A replay never reaches the network: Qloo and Claude answers are all recorded.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("A replay tried to reach the network.");
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe.each(EXAMPLES.map((e) => [e.slug] as const))("%s recorded full run", (slug) => {
  const { events, report } = stored[slug];

  it("reduces to exactly the stored report", () => {
    expect(toReport(reduce(events))).toEqual(report);
  });

  it("replays from recorded Qloo and Claude answers to the same events and report, byte for byte", async () => {
    const replayed = await recordExampleBrief(slug, replayOptions(slug, INTERIM_CREATIVE));
    expect(asStored(replayed.events)).toBe(readFileSync(`data/runs/${slug}/run.events.json`, "utf8"));
    expect(asStored(replayed.report)).toBe(readFileSync(`data/runs/${slug}/run.report.json`, "utf8"));
  });

  it("builds a world per measured segment, each with Qloo signal on at least 4 brief fields", () => {
    expect(report.worlds.map((w) => w.segmentId)).toEqual(report.audience.segments?.items.map((s) => s.id));
    for (const world of report.worlds) {
      expect(world.culture?.filter((f) => f.signal !== "none").length, world.segmentId).toBeGreaterThanOrEqual(4);
      expect(world.richSlots.length, world.segmentId).toBeGreaterThan(0);
    }
  });

  it("sets each world in a different one of the audience's stable headline cities", () => {
    const headline = report.audience.proof?.cityRanks.filter((c) => c.flags.length === 0 && c.rank <= 5).map((c) => c.label) ?? [];
    const cities = report.worlds.map((w) => w.settingCity?.label);
    for (const city of cities) expect(headline).toContain(city);
    expect(new Set(cities).size).toBe(cities.length);
  });

  it("never puts a real name in brief wording: every candidate, seed and panel name stays in the receipts", () => {
    const names = [
      ...report.inputs.seeds.map((s) => s.ref.name),
      ...report.worlds.flatMap((w) => (w.culture ?? []).flatMap((f) => f.sources.filter((s) => s.kind === "entity").map((s) => s.name))),
    ].filter((name) => /\s/.test(name) || name !== name.toLowerCase());
    for (const world of report.worlds) {
      const brief = world.brief!;
      const texts = [brief.music, brief.visual, brief.mood, brief.voice.tone, brief.productRole, ...brief.setting, ...(brief.wardrobe ? [brief.wardrobe] : []), ...(brief.talent ? [brief.talent] : []), ...brief.hooks].map((c) => c.text);
      for (const text of texts) {
        const issues = checkText(text, { names, allowedNames: brief.allowedPlaces });
        expect(issues.map((i) => i.message), `${world.segmentId}: ${text}`).toEqual([]);
      }
    }
  });

  it("labels every cue honestly: Qloo-backed wording is interpreted with receipts, the rest is creative", () => {
    for (const world of report.worlds) {
      const brief = world.brief!;
      for (const cue of [brief.music, brief.visual, brief.mood, brief.voice.tone, ...brief.setting]) {
        expect(["interpreted", "creative"]).toContain(cue.origin);
        if (cue.origin === "interpreted") expect(cue.evidenceIds.length).toBeGreaterThan(0);
      }
      expect(brief.productRole.origin).toBe("creative");
      for (const hook of brief.hooks) expect(hook.origin).toBe("creative");
    }
  });

  it("keeps each world's agent within its probes, and counts the Control's choices against every world", () => {
    for (const world of report.worlds) {
      const probes = report.trace.filter((t) => t.segmentId === world.segmentId && /^(Searching Qloo's|Probing more|Scoring probed)/.test(t.label));
      expect(probes.length).toBeLessThanOrEqual(MAX_PROBES);
    }
    expect(report.control?.fits.map((f) => f.segmentId)).toEqual(report.worlds.map((w) => w.segmentId));
    for (const fit of report.control?.fits ?? []) {
      expect(fit.line).toMatch(/^\d+ of \d+ checkable LLM-only choices? miss(es)? what Qloo measured for this world/);
      expect(fit.range?.runs).toBe(3);
    }
    expect(report.comparison?.worlds).toHaveLength(report.worlds.length);
  });

  it("scores every world against the reference panels with its own signal", () => {
    for (const world of report.worlds) {
      const scored = world.check?.picks.filter((p) => p.from === "qloo" && p.position) ?? [];
      expect(scored.length).toBeGreaterThanOrEqual(20);
      for (const pick of scored) expect(pick.position!.beats).toBeLessThanOrEqual(pick.position!.of);
    }
  });
});

describe("what the lead example's worlds show", () => {
  const report = stored["food-hot-sauce"].report;

  it("sets the 55 and older world in Slidell and the 35 to 44 world in Baton Rouge, the cities the Reality Check names", () => {
    expect(report.worlds.map((w) => [w.segmentId, w.settingCity?.label])).toEqual([
      ["seg-55-and-older", "Slidell, LA"],
      ["seg-35-to-44", "Baton Rouge, LA"],
    ]);
  });

  it("flags the generic brief's guessed cities as cliches in both worlds", () => {
    for (const world of report.worlds) {
      expect(world.check?.cliches.filter((c) => c.dimension === "cities").map((c) => c.assumed)).toEqual(["A generic AI brief assumed Austin.", "A generic AI brief assumed Portland."]);
    }
  });
});

describe("the comparison", () => {
  it("says the same miss once when every world shares it, and lists them otherwise", () => {
    expect(stored["food-hot-sauce"].report.comparison?.headline).toBe("The generic brief missed 3 of 6 checkable choices in each world.");
    expect(stored["home-candles"].report.comparison?.headline).toBe("The generic brief missed 3 of 5, then 2 of 5 checkable choices across the worlds.");
  });

  it("has nothing to compare before a world has been checked", () => {
    expect(compareWorlds([{ segmentId: "seg-a", label: "a", check: null }], [])).toBeNull();
  });
});
