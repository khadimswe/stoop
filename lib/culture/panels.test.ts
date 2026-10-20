import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientLookup, controlText, loadRuns, mapTag, resolveName, toneTag, type Recipe } from "../data-check/plan";
import { CANDIDATES } from "../demo/candidates";
import { seedType } from "../demo/seed-types";
import { checkText } from "../guardrails";
import { createQlooClient } from "../qloo/client";
import { createRunContext } from "../qloo/context";
import { FixtureCache } from "../qloo/fixtures";
import { describeRecorded, HAS_RECORDED_DATA, ifRecorded } from "../testing/recorded";
import { loadPanels, parsePanels, referencePanels } from "./panels";

const panels = ifRecorded(() => ({ ...referencePanels().entity, ...referencePanels().tag }));
const scoring = ifRecorded(() => JSON.parse(readFileSync("fixtures/recipes/pool-scoring.json", "utf8")) as Recipe);

describeRecorded("frozen reference panels", () => {
  it("hold 25 unique entries each, at most 3 from any candidate's list", () => {
    for (const [name, panel] of Object.entries(panels)) {
      expect(panel, name).toHaveLength(25);
      expect(new Set(panel.map((p) => p.id)).size).toBe(25);
      const perSource = new Map<string, number>();
      for (const p of panel) {
        const source = p.request.split("--")[0];
        perSource.set(source, (perSource.get(source) ?? 0) + 1);
      }
      for (const count of perSource.values()) expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("are spread across popularity, lowest first", () => {
    for (const panel of Object.values(panels)) {
      const pops = panel.map((p) => p.popularity);
      expect([...pops].sort((a, b) => a - b)).toEqual(pops);
      expect(pops[24] - pops[0]).toBeGreaterThan(0.05);
    }
  });

  it("never hold a name the minor or ethnicity guardrails flag", () => {
    for (const panel of Object.values(panels)) {
      for (const p of panel) expect(checkText(p.name).filter((i) => i.rule === "minor" || i.rule === "ethnicity")).toEqual([]);
    }
  });

  it("never hold a seed, a Control pick or a Control tag", async () => {
    const lookup = clientLookup(createQlooClient({ cache: FixtureCache.fromDir("fixtures", { strict: true }) }), createRunContext({ runId: "test", cap: 0 }));
    const excluded = new Set<string>();
    for (const candidate of CANDIDATES) {
      for (const seed of candidate.seeds) {
        const resolved = await resolveName(seed, seedType(seed), lookup);
        if (resolved.entity) excluded.add(resolved.entity.id);
      }
      const control = controlText(candidate, loadRuns(candidate.slug));
      for (const ref of control.references) {
        const resolved = await resolveName(ref.name, ref.type, lookup);
        if (resolved.entity) excluded.add(resolved.entity.id);
      }
      // The Control's music and mood tags are scored against the tag panels, so they are never in them.
      const music = await mapTag("music", control.musicTerm, lookup);
      if (music.tag) excluded.add(music.tag.id);
      const tone = toneTag(control.moodTerm).tag;
      if (tone) excluded.add(tone.id);
    }
    expect(excluded.size).toBeGreaterThan(30);
    for (const panel of Object.values(panels)) for (const p of panel) expect(excluded.has(p.id)).toBe(false);
  });

  it("are exactly what the recorded scoring calls sent, so they stay frozen", () => {
    const sent = new Set(scoring.requests.flatMap((r) => (r.params["filter.results.entities"] ?? r.params["filter.results.tags"]) as string[]));
    for (const panel of Object.values(panels)) for (const p of panel) expect(sent.has(p.id)).toBe(true);
  });
});

describe("the panels file", () => {
  const entry = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name: `Made-up entry ${n}`, popularity: n / 10, request: "made-up--artist" });
  const file = (entity: Record<string, unknown>) => ({ source: "test", built: "2026-01-01", entity, tag: { music: [entry(1)], tone: [entry(2)] } });

  it("reads a valid file", () => {
    expect(parsePanels(file({ artist: [entry(1)], brand: [entry(2)], movie: [entry(3)], tv_show: [entry(1)] })).entity.brand).toEqual([entry(2)]);
  });

  it("rejects a file missing a panel", () => {
    expect(() => parsePanels(file({ artist: [entry(1)], brand: [entry(2)], movie: [entry(3)] }))).toThrow();
  });

  it.skipIf(HAS_RECORDED_DATA)("names the generating command when the file is missing", () => {
    expect(() => loadPanels()).toThrow(/npm run data-check -- panels/);
  });
});
