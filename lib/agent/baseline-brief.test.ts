import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATES } from "../demo/candidates";
import { defaultPackSettings } from "../prompts/brief";
import { buildProductionPack, checkPack, packHashes, type ProductionPack } from "../prompts/pack";
import { bestConcept, conceptInputHash, conceptRunSchema } from "../stages/concepts";
import { baselineNames, baselineRunSchema } from "./baseline";
import { candidateDirection, candidateProduct, CONTROL_RUN, controlBrief } from "./baseline-brief";

const root = process.cwd();
const json = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

// Every committed Control goes through the real pack builder and checks, with zero API calls.
const controls = CANDIDATES.filter((c) => existsSync(path.join(root, "data/baselines", c.slug, "concepts.json")));

describe("committed baselines", () => {
  it("parse against the run schema", () => {
    const dir = path.join(root, "data/baselines");
    if (!existsSync(dir)) return;
    for (const slug of readdirSync(dir)) {
      for (const file of readdirSync(path.join(dir, slug)).filter((f) => /^run-\d+\.json$/.test(f))) {
        const run = baselineRunSchema.parse(json(path.join(dir, slug, file)));
        expect(run.candidate).toBe(slug);
        expect(file).toBe(`run-${run.run}.json`);
      }
    }
  });

  it.each(controls.map((c) => [c.slug, c] as const))("%s: the Control pack passes every check", (_slug, candidate) => {
    const dir = path.join(root, "data/baselines", candidate.slug);
    const run = baselineRunSchema.parse(json(path.join(dir, `run-${CONTROL_RUN}.json`)));
    const concepts = conceptRunSchema.parse(json(path.join(dir, "concepts.json")));
    expect(concepts.briefId).toBe("control");
    const product = candidateProduct(candidate);
    const brief = controlBrief(run);
    // The concepts were written from exactly this run 1, product and direction (with the concept
    // instructions of their day: newer instructions make them stale, not wrong).
    // They also predate the seller facts on the product spec, so the hash is of the product as it was.
    const { sellerFacts: _facts, ...writtenFor } = product;
    void _facts;
    expect(concepts.inputHash).toBe(conceptInputHash(writtenFor, brief, candidateDirection(candidate), concepts.instructionsHash));
    const pack = buildProductionPack({ product, brief, concept: bestConcept(concepts), settings: defaultPackSettings(candidateDirection(candidate)) });
    expect(checkPack(pack, brief, product, baselineNames(run, candidate), { richSlots: [] })).toEqual([]);
    // The Control never names a city the LLM guessed.
    for (const city of run.brief.assumedCities) {
      for (const render of pack.renders) expect(render.prompt).not.toContain(city);
    }
  });
});

describe("frozen packs", () => {
  // A frozen pack is what the founder approved. Re-rendering it from the committed inputs must give
  // the same hashes; a template change breaks this test and forces a new review and render.
  const dir = path.join(root, "data/packs");
  const frozen = existsSync(dir) ? readdirSync(dir).filter((slug) => existsSync(path.join(dir, slug, "control.json"))) : [];

  it.each(frozen.map((slug) => [slug] as const))("%s re-renders to the approved hashes", (slug) => {
    const candidate = CANDIDATES.find((c) => c.slug === slug);
    expect(candidate).toBeDefined();
    if (!candidate) return;
    const base = path.join(root, "data/baselines", slug);
    const run = baselineRunSchema.parse(json(path.join(base, `run-${CONTROL_RUN}.json`)));
    const concepts = conceptRunSchema.parse(json(path.join(base, "concepts.json")));
    const pack = buildProductionPack({
      product: candidateProduct(candidate),
      brief: controlBrief(run),
      concept: bestConcept(concepts),
      settings: defaultPackSettings(candidateDirection(candidate)),
    });
    const approved = json(path.join(dir, slug, "control.json")) as ProductionPack;
    expect(packHashes(pack)).toEqual(packHashes(approved));
  });

  it("are all listed in approvals.json", () => {
    const approvals = json(path.join(root, "public/demo/approvals.json")) as { prompts: string[] };
    for (const slug of frozen) {
      const pack = json(path.join(dir, slug, "control.json")) as ProductionPack;
      for (const { promptHash } of packHashes(pack)) expect(approvals.prompts).toContain(promptHash);
    }
  });
});
