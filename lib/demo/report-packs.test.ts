// The examples' Production Packs as their reports recorded them: the export lists exactly the reports'
// pack hashes (plus the demo packshot), every review file says it is not approved, a freeze refuses any
// pack with an unapproved hash, and a committed frozen pack equals its report pack with every hash
// approved. Zero API calls; data/runs is only read.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packHashes, productionPackSchema } from "../prompts/pack";
import { exportHashes, packshotPlan } from "./demo-renders";
import { EXAMPLES } from "./examples";
import { approvalsSchema } from "./manifest";
import { NOT_APPROVED, reportExport } from "./report-export";
import { freezeReportPacks, frozenReportPackFile, isExampleSlug, loadExampleReport, reportPackProblems, reportPacks } from "./report-packs";

const slugs = EXAMPLES.map((e) => e.slug);
const EM_DASH = String.fromCharCode(0x2014);

describe("the export from the reports", () => {
  it.each(slugs.map((s) => [s] as const))("%s: lists exactly each report pack's hashes, plus the demo packshot", (slug) => {
    const report = loadExampleReport(slug);
    const files = reportExport(report);
    const hashes = JSON.parse(files.find((f) => f.name === "hashes.json")!.text) as { packs: { key: string; hashes: unknown }[]; prompts: string[]; demo: { promptHash: string }[] };
    const entries = reportPacks(report);
    expect(hashes.packs.map((p) => p.key)).toEqual(entries.map((e) => e.key));
    for (const entry of entries) {
      expect(hashes.packs.find((p) => p.key === entry.key)?.hashes).toEqual(packHashes(entry.pack));
      const markdown = files.find((f) => f.name === `${entry.key}.md`)!.text;
      // Every prompt and its hash is in the review file, word for word.
      for (const item of [...entry.pack.assets, ...entry.pack.renders]) {
        expect(markdown).toContain(item.promptHash);
        expect(markdown).toContain(item.prompt);
      }
      expect(markdown).toContain(entry.pack.directorGuide.split("\n").at(-1));
      expect(markdown).toContain(entry.pack.disclosure);
    }
    const all = new Set([...entries.flatMap((e) => packHashes(e.pack).map((h) => h.promptHash)), packshotPlan(report).promptHash]);
    expect(new Set(hashes.prompts)).toEqual(all);
    expect(hashes.prompts).toHaveLength(all.size);
    expect(hashes.demo.map((d) => d.promptHash)).toEqual([packshotPlan(report).promptHash]);
    expect(exportHashes(report).map((h) => h.promptHash)).toEqual(hashes.prompts);
  });

  it.each(slugs.map((s) => [s] as const))("%s: opens every file with the not-approved status and has no em dash", (slug) => {
    for (const file of reportExport(loadExampleReport(slug))) {
      expect(file.text.includes(EM_DASH), file.name).toBe(false);
      if (file.name.endsWith(".json")) {
        const json = JSON.parse(file.text) as Record<string, unknown>;
        expect(Object.keys(json)[0]).toBe("status");
        expect(json.status).toBe(NOT_APPROVED);
      } else {
        expect(file.text.split("\n").slice(0, 3).join("\n"), file.name).toContain(`${NOT_APPROVED}.`);
      }
    }
  });

  it.each(slugs.map((s) => [s] as const))("%s: every recorded pack still passes the pack checks", (slug) => {
    const report = loadExampleReport(slug);
    for (const entry of reportPacks(report)) expect(reportPackProblems(report, entry), entry.key).toEqual([]);
  });

  it("flags a recorded prompt that no longer matches what the templates build, even with its old hash", () => {
    const report = loadExampleReport("food-hot-sauce");
    const entry = reportPacks(report)[1];
    const [first, ...rest] = entry.pack.renders;
    const tampered = { ...entry, pack: { ...entry.pack, renders: [{ ...first, prompt: `${first.prompt} Add a second bottle.` }, ...rest] } };
    expect(reportPackProblems(report, tampered).map((p) => p.where)).toContain("pack");
  });

  it("shares one packshot asset across a report's packs and renders it from that asset's prompt", () => {
    const report = loadExampleReport("food-hot-sauce");
    const plan = packshotPlan(report);
    expect(plan.asset.file).toBe("packshot.png");
    expect(plan.prompt).toBe(report.control!.pack!.assets.find((a) => a.kind === "packshot")!.prompt);
    expect(plan.prompt).toMatch(/free of text, props and people/);
    // FLUX [schnell] is asked for JPEG, and its bytes are kept as they come.
    expect(plan.format).toBe("jpeg");
    expect(plan.file).toBe("/demo/food-hot-sauce/packshot.jpg");
  });
});

describe("freezing from the reports", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const tempRoot = () => {
    root = mkdtempSync(path.join(tmpdir(), "stoop-freeze-"));
    mkdirSync(path.join(root, "data"), { recursive: true });
    symlinkSync(path.join(process.cwd(), "data", "runs"), path.join(root, "data", "runs"));
    return root;
  };

  it("refuses every pack with any unapproved hash and writes nothing for it", async () => {
    tempRoot();
    const report = loadExampleReport("food-hot-sauce");
    const control = reportPacks(report)[0];
    // Every Control hash but one.
    const prompts = packHashes(control.pack).slice(1).map((h) => h.promptHash);
    const result = await freezeReportPacks("food-hot-sauce", { prompts }, root);
    expect(result.written).toEqual([]);
    expect(result.refused.map((r) => r.key)).toEqual(reportPacks(report).map((e) => e.key));
    expect(result.refused[0].missing).toEqual([packHashes(control.pack)[0]]);
    expect(existsSync(path.join(root, "data", "packs"))).toBe(false);
  });

  it("writes each fully approved pack exactly as the report holds it", async () => {
    tempRoot();
    const report = loadExampleReport("home-candles");
    const [control, first, second] = reportPacks(report);
    const prompts = [...packHashes(control.pack), ...packHashes(first.pack)].map((h) => h.promptHash);
    const result = await freezeReportPacks("home-candles", { prompts }, root);
    expect(result.written).toEqual([frozenReportPackFile("home-candles", "control"), frozenReportPackFile("home-candles", first.key)]);
    expect(result.refused.map((r) => r.key)).toEqual([second.key]);
    for (const entry of [control, first]) {
      const frozen = productionPackSchema.parse(JSON.parse(readFileSync(path.join(root, frozenReportPackFile("home-candles", entry.key)), "utf8")));
      expect(frozen).toEqual(entry.pack);
    }
  });
});

describe("committed frozen packs", () => {
  // A frozen pack is what the founder approved: it must equal its report pack, and every hash in it
  // must be approved. A recorded report that changes breaks this test and forces a new review.
  const dir = path.join(process.cwd(), "data", "packs");
  const frozen = existsSync(dir)
    ? readdirSync(dir)
        .filter(isExampleSlug)
        .flatMap((slug) => readdirSync(path.join(dir, slug)).filter((f) => f.endsWith(".json")).map((file) => ({ slug, key: file.replace(/\.json$/, "") })))
    : [];
  const approvals = approvalsSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "public", "demo", "approvals.json"), "utf8")));

  it("equal their report packs, and every hash is approved", () => {
    for (const { slug, key } of frozen) {
      const entry = reportPacks(loadExampleReport(slug)).find((e) => e.key === key);
      expect(entry, `${slug}/${key}.json has no pack in the report`).toBeDefined();
      const pack = productionPackSchema.parse(JSON.parse(readFileSync(path.join(dir, slug, `${key}.json`), "utf8")));
      expect(pack, `${slug}/${key}`).toEqual(entry!.pack);
      for (const { promptHash, id } of packHashes(pack)) expect(approvals.prompts, id).toContain(promptHash);
    }
  });
});
