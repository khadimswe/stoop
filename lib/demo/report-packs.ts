// The example reports' Production Packs, the source of truth for demo approvals (decided Oct 17): the
// Control's pack and each world's pack, as data/runs/<slug>/run.report.json recorded them. The export
// (scripts/export-pack.ts --from-report) writes them for review, the founder approves their hashes by
// hand in public/demo/approvals.json, and --freeze then records each approved pack in
// data/packs/<slug>/<key>.json. A frozen pack must equal its report pack, and every hash in it must be
// approved (the committed-files test). Nothing here calls an API; data/runs is only ever read.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashOf } from "../hash";
import type { BriefSlots } from "../prompts/brief";
import { buildProductionPack, checkPack, packHashes, type PackProblem, type ProductionPack } from "../prompts/pack";
import { reportSchema, type Report } from "../report/schema";
import { CONTROL_ID, type ConceptSet, type CultureFieldResult, type Kit, type SettingCity } from "../report/world";
import { reportNames } from "../stages/after-run";
import type { DemoApprovals } from "./manifest";
import { EXAMPLES, type ExampleSlug } from "./examples";

export const isExampleSlug = (slug: string): slug is ExampleSlug => EXAMPLES.some((e) => e.slug === slug);

export const reportFile = (slug: string) => path.join("data", "runs", slug, "run.report.json");
/** Where an approved pack is frozen: data/packs/<slug>/control.json or data/packs/<slug>/<segmentId>.json. */
export const frozenReportPackFile = (slug: string, key: string) => path.join("data", "packs", slug, `${key}.json`);

/** Reads and validates an example's recorded report (read only: golden tests compare data/runs byte for byte). */
export function loadExampleReport(slug: ExampleSlug, root = process.cwd()): Report {
  const file = path.join(root, reportFile(slug));
  if (!existsSync(file)) throw new Error(`Missing ${reportFile(slug)}. Run npm run example -- ${slug} first.`);
  return reportSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** One pack of a report: the Control's or one world's, with what the review file prints beside it. */
export interface ReportPack {
  /** "control" or the world's segment id: the export and freeze file name. */
  key: string;
  /** Null for the Control (as in the demo manifest). */
  segmentId: string | null;
  label: string;
  pack: ProductionPack;
  brief: BriefSlots;
  concepts: ConceptSet | null;
  kit: Kit | null;
  /** The world's Culture Brief fields with their Qloo sources; null for the Control. */
  culture: CultureFieldResult[] | null;
  settingCity: SettingCity | null;
  /** Brief slots Qloo backed richly; empty for the Control. */
  richSlots: string[];
}

/** The Control first, then the worlds in report order. A report part without a pack is an error: examples are complete. */
export function reportPacks(report: Report): ReportPack[] {
  const packs: ReportPack[] = [];
  const control = report.control;
  if (!control?.pack) throw new Error(`${report.meta.id} has no Control pack.`);
  packs.push({ key: CONTROL_ID, segmentId: null, label: "Control (LLM-only brief)", pack: control.pack, brief: control.brief, concepts: control.concepts, kit: control.kit, culture: null, settingCity: null, richSlots: [] });
  for (const world of report.worlds) {
    if (!world.pack || !world.brief) throw new Error(`${report.meta.id}: world ${world.segmentId} has no pack.`);
    packs.push({ key: world.segmentId, segmentId: world.segmentId, label: world.label, pack: world.pack, brief: world.brief, concepts: world.concepts, kit: world.kit, culture: world.culture, settingCity: world.settingCity, richSlots: world.richSlots });
  }
  return packs;
}

/**
 * The pack checks, run again on the recorded packs (brief coverage, references, guardrails, seller
 * facts), plus a rebuild: the recorded pack must be exactly what today's templates make from its own
 * brief, concept and settings, so an approved hash always pins the prompt text it was shown with.
 */
export function reportPackProblems(report: Report, entry: ReportPack): PackProblem[] {
  const problems = checkPack(entry.pack, entry.brief, report.inputs.product, reportNames(report), { richSlots: entry.richSlots });
  const rebuilt = buildProductionPack({ product: report.inputs.product, brief: entry.brief, concept: entry.pack.concept, settings: entry.pack.settings });
  if (hashOf(JSON.parse(JSON.stringify(rebuilt))) !== hashOf(entry.pack)) {
    problems.push({ where: "pack", message: "the recorded pack differs from what the current templates build from its brief and concept; re-record the example (npm run example) before approving it" });
  }
  return problems;
}

/** A pack's hashes that are not in approvals.prompts yet. */
export function unapprovedHashes(pack: ProductionPack, approvals: Pick<DemoApprovals, "prompts">): { id: string; promptHash: string }[] {
  const approved = new Set(approvals.prompts);
  return packHashes(pack).filter((h) => !approved.has(h.promptHash));
}

/** JSON for committed files: U+2014 (in Qloo's names) is written as an escape so the em dash scan stays clean. */
export const committedJson = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

export interface FreezeResult {
  /** Files written, relative to the root. */
  written: string[];
  /** Packs left unfrozen, with the hashes still to approve. */
  refused: { key: string; missing: { id: string; promptHash: string }[] }[];
}

/**
 * Freezes every report pack whose hashes are all approved into data/packs/<slug>/<key>.json, exactly
 * as the report holds it. A pack with any unapproved hash is refused and not written. Runs the pack
 * checks first: a recorded pack that fails them is never frozen.
 */
export async function freezeReportPacks(slug: ExampleSlug, approvals: Pick<DemoApprovals, "prompts">, root = process.cwd()): Promise<FreezeResult> {
  const report = loadExampleReport(slug, root);
  const result: FreezeResult = { written: [], refused: [] };
  for (const entry of reportPacks(report)) {
    const problems = reportPackProblems(report, entry);
    if (problems.length > 0) throw new Error(`${slug}/${entry.key}: the pack fails its checks (${problems[0].where}: ${problems[0].message}); nothing frozen.`);
    const missing = unapprovedHashes(entry.pack, approvals);
    if (missing.length > 0) {
      result.refused.push({ key: entry.key, missing });
      continue;
    }
    const file = frozenReportPackFile(slug, entry.key);
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), committedJson(entry.pack));
    result.written.push(file);
  }
  return result;
}
