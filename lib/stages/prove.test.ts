import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { replayClient } from "../demo/example-run";
import { createEmitter } from "../events";
import { referenceSets } from "../geo/reference";
import { checkText } from "../guardrails";
import { createRunContext } from "../qloo/context";
import type { Report } from "../report/schema";
import { prove, proveRequests } from "./prove";
import { describeRecorded, ifRecorded } from "../testing/recorded";

const sauce = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/audience.report.json", "utf8")) as Report);

describeRecorded("Prove", () => {
  it("stops as partial with fewer than 2 seeds, before any Qloo call", async () => {
    const emitter = createEmitter(() => new Date("2026-10-16T20:00:00.000Z"));
    const ctx = createRunContext({ runId: "prove-test", cap: 4 });
    const result = await prove(
      { client: replayClient(), ctx, emit: emitter.emit, reference: referenceSets(), inReference: false },
      { seeds: sauce.inputs.seeds.slice(0, 1), region: "United States" },
    );
    expect(result).toEqual({ partial: "Need at least 2 seeds Qloo knows." });
    expect(ctx.liveCalls + ctx.cachedCalls).toBe(0);
  });

  it("sends the same params the Gate 2 data check recorded", () => {
    const requests = proveRequests(sauce.inputs.seeds, "United States");
    expect(requests.heatmap).toMatchObject({ "filter.type": "urn:heatmap", "filter.location.query": "United States" });
    expect(requests.music).toMatchObject({ "filter.tag.types": ["urn:tag:genre:music"], take: 30 });
  });

  it("never keeps a taste tag the minor or ethnicity guardrails flag", () => {
    for (const slug of ["food-hot-sauce", "home-candles", "pets-outfits"]) {
      const report = JSON.parse(readFileSync(`data/runs/${slug}/audience.report.json`, "utf8")) as Report;
      for (const tag of report.audience.proof?.tags ?? []) {
        expect(checkText(tag.name).filter((i) => i.rule === "minor" || i.rule === "ethnicity")).toEqual([]);
      }
    }
  });
});
