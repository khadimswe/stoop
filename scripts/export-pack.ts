// Writes Production Packs for the founder to review before any render: the brief with its origins, all
// three concepts with rubric scores, every asset and render prompt with its hash and start frame, the
// shot list, the kit scripts and captions, the critique checklist and the Director's Guide.
//
// From the example reports (the source of truth for demo approvals since Oct 17; an example's slug
// always exports from here unless --baseline is given):
//   npm run prompts:export -- <slug>|--all-examples [--from-report] [--freeze]
// writes exports/<slug>/ with README.md, control.md, one <segmentId>.md per world and hashes.json.
// --freeze (one slug at a time) writes data/packs/<slug>/<key>.json for every pack whose hashes are all
// in public/demo/approvals.json, and refuses the rest.
//
// From the baselines (the older Control of the candidates; --all leaves the examples out):
//   npm run prompts:export -- <slug>|--all [--freeze]
//   npm run prompts:export -- <example slug> --baseline
// writes exports/<slug>/production-pack.md and hashes.json (exports/<slug>/baseline/ for an example, so
// it never replaces the report's review files). Concepts written with older instructions still export,
// with a warning. --freeze writes data/packs/<slug>/control.json; the examples freeze from their reports.
// Review files go to exports/ (gitignored). Zero API calls: it reads committed files only.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { baselineNames, baselineRunSchema, type BaselineRun } from "../lib/agent/baseline";
import { candidateDirection, candidateProduct, CONTROL_RUN, controlBrief } from "../lib/agent/baseline-brief";
import { parseCliArgs, type CliArgs } from "../lib/cli-args";
import { CANDIDATES, type Candidate } from "../lib/demo/candidates";
import { EXAMPLES, type ExampleSlug } from "../lib/demo/examples";
import { approvalsSchema } from "../lib/demo/manifest";
import { conceptLines, hashLines, packLines } from "../lib/demo/pack-markdown";
import { reportExport } from "../lib/demo/report-export";
import { freezeReportPacks, isExampleSlug, loadExampleReport, reportPackProblems, reportPacks } from "../lib/demo/report-packs";
import { defaultPackSettings, type BriefSlots, type ProductSpec } from "../lib/prompts/brief";
import { buildProductionPack, checkPack, packHashes, type ProductionPack } from "../lib/prompts/pack";
import { buildKitScripts, pickUgcFormat } from "../lib/prompts/ugc";
import { bestConcept, conceptRunSchema, conceptSet, conceptsStatus, type ConceptRun } from "../lib/stages/concepts";
import { ageBandLabel, type Cue } from "../lib/types";

const EM_DASH = String.fromCharCode(0x2014);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJson(file: string): Promise<unknown> {
  if (!existsSync(file)) fail(`Missing ${file}. Run npm run baseline -- <slug> first.`);
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadControl(candidate: Candidate): Promise<{ run: BaselineRun; concepts: ConceptRun }> {
  const dir = path.join("data", "baselines", candidate.slug);
  const run = baselineRunSchema.parse(await readJson(path.join(dir, `run-${CONTROL_RUN}.json`)));
  const concepts = conceptRunSchema.parse(await readJson(path.join(dir, "concepts.json")));
  return { run, concepts };
}

const origin = (cue: Cue) => (cue.origin === "creative" ? "not from Qloo" : cue.origin);

function markdown(candidate: Candidate, run: BaselineRun, concepts: ConceptRun, brief: BriefSlots, product: ProductSpec, pack: ProductionPack): string {
  const hashes = packHashes(pack);
  const ranked = conceptSet(concepts, brief);
  const format = pickUgcFormat(pack.concept);
  const kit = buildKitScripts({ product, brief, concept: pack.concept, names: baselineNames(run, candidate) });
  const { audience, references, assumedCities } = run.brief;
  const lines: string[] = [
    `# Production Pack: ${candidate.workingName} (Control)`,
    "",
    "**Status: not approved.** Review every prompt before any render. Approve by adding the hashes at the end to `public/demo/approvals.json`.",
    "",
    `This is the **Control**: an LLM-only brief written with no Qloo data (run ${run.run} of the baseline, fixed in advance). It uses the same concept writer, templates, models and settings as the culture-made packs; only the brief differs.`,
    "",
    `- Model: ${run.modelId}, effort ${run.effort}. Baseline ${run.generatedAt}, concepts ${concepts.generatedAt}.`,
    `- Template version ${pack.templateVersion}. Settings hash \`${pack.settingsHash}\`.`,
    `- Creative direction: look ${pack.settings.direction.look}, cast ${pack.settings.direction.cast} (resolved: ${pack.cast}), energy ${pack.settings.direction.energy}${pack.settings.direction.notes ? `, notes "${pack.settings.direction.notes}"` : ""}.`,
    "",
    "## Product",
    "",
    `- ${candidate.product.name}, ${candidate.product.price}, ${candidate.product.category}`,
    `- ${candidate.product.description}`,
    `- Look (for the packshot): ${candidate.product.lookDescription}`,
    `- Seeds: ${candidate.seeds.join(", ")}`,
    `- Stated customer: ${candidate.statedCustomer}`,
    "",
    "## The LLM-only brief",
    "",
    `- Assumed audience: ${audience.ageBands.map(ageBandLabel).join(", ")}, gender skew ${audience.genderSkew}. ${audience.description}`,
    `- Product role (${origin(brief.productRole)}): ${brief.productRole.text}`,
    `- Mood (${origin(brief.mood)}): ${brief.mood.text}`,
    `- Music (${origin(brief.music)}): ${brief.music.text}`,
    `- Visual language (${origin(brief.visual)}): ${brief.visual.text}`,
    brief.wardrobe ? `- Wardrobe (${origin(brief.wardrobe)}): ${brief.wardrobe.text}` : "- Wardrobe: none",
    `- Setting (not from Qloo): ${brief.setting.map((cue) => cue.text).join("; ")}`,
    `- Voice (${origin(brief.voice.tone)}): ${brief.voice.tone.text}. Use: ${brief.voice.use.join(", ")}. Avoid: ${brief.voice.avoid.join(", ")}`,
    brief.talent ? `- Talent (${origin(brief.talent)}): ${brief.talent.text}` : "- Talent: none (no people on screen)",
    `- Hooks: ${brief.hooks.map((cue) => `"${cue.text}"`).join(" / ")}`,
    "",
    "**Named references** (kept for Qloo scoring in Gate 2; never in any prompt):",
    "",
    ...Object.entries(references).map(([type, names]) => `- ${type}: ${names.length ? names.join(", ") : "-"}`),
    `- assumed cities: ${assumedCities.length ? assumedCities.join(", ") : "-"}`,
    "",
    ...conceptLines(ranked),
    ...packLines(pack, kit, format.reason),
    ...hashLines(hashes),
  ];
  return lines.join("\n");
}

async function writeChecked(file: string, text: string): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (key && text.includes(key)) fail(`Refusing to write ${file}: an API key appeared in the output.`);
  if (text.includes(EM_DASH)) fail(`Refusing to write ${file}: it contains an em dash.`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

async function exportOne(candidate: Candidate, freeze: boolean): Promise<boolean> {
  if (freeze && isExampleSlug(candidate.slug)) {
    console.error(`${candidate.slug} is an example: its packs freeze from its report. Run npm run prompts:export -- ${candidate.slug} --from-report --freeze.`);
    return false;
  }
  const { run, concepts } = await loadControl(candidate);
  const product = candidateProduct(candidate);
  const settings = defaultPackSettings(candidateDirection(candidate));
  const brief = controlBrief(run);
  const status = conceptsStatus(concepts, product, brief, settings.direction);
  if (status === "other-input") {
    console.error(`${candidate.slug}: concepts.json was written from a different run 1. Run npm run baseline -- ${candidate.slug} to refresh it.`);
    return false;
  }
  if (status === "stale-instructions") {
    // Same brief, older concept writer: still a valid review file, but never one to approve.
    if (freeze) {
      console.error(`${candidate.slug}: concepts.json was written with older concept instructions. Refresh it (npm run baseline -- ${candidate.slug}) before freezing.`);
      return false;
    }
    console.warn(`${candidate.slug}: concepts.json was written with older concept instructions (no declared slots or test hypothesis). Exporting for review; refresh it before approving.`);
  }
  const pack = buildProductionPack({ product, brief, concept: bestConcept(concepts), settings });
  // The Control has no Qloo data, so no slot is rich.
  const problems = checkPack(pack, brief, product, baselineNames(run, candidate), { richSlots: [] });
  if (problems.length > 0) {
    console.error(`${candidate.slug}: ${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
    return false;
  }
  // An example's report export owns exports/<slug>/; its older Control goes beside it.
  const dir = isExampleSlug(candidate.slug) ? path.join("exports", candidate.slug, "baseline") : path.join("exports", candidate.slug);
  await writeChecked(path.join(dir, "production-pack.md"), markdown(candidate, run, concepts, brief, product, pack));
  await writeChecked(path.join(dir, "hashes.json"), `${JSON.stringify(packHashes(pack), null, 2)}\n`);
  if (freeze) await writeChecked(path.join("data", "packs", candidate.slug, "control.json"), `${JSON.stringify(pack, null, 2)}\n`);
  console.log(`${candidate.slug}: ${pack.assets.length} assets, ${pack.renders.length} render prompts -> ${dir}/production-pack.md${freeze ? " (frozen)" : ""}`);
  return true;
}

/** The review files from an example's report, after the pack checks pass; with freeze, the approved packs too. */
async function exportReport(slug: ExampleSlug, freeze: boolean): Promise<boolean> {
  const report = loadExampleReport(slug);
  const entries = reportPacks(report);
  let ok = true;
  for (const entry of entries) {
    const problems = reportPackProblems(report, entry);
    if (problems.length === 0) continue;
    ok = false;
    console.error(`${slug}/${entry.key}: ${problems.length} problem(s), nothing written:`);
    for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
  }
  if (!ok) return false;
  const dir = path.join("exports", slug);
  for (const file of reportExport(report)) await writeChecked(path.join(dir, file.name), file.text);
  const prompts = entries.reduce((sum, e) => sum + e.pack.assets.length + e.pack.renders.length, 0);
  console.log(`${slug}: ${entries.length} packs (${entries.map((e) => e.key).join(", ")}), ${prompts} asset and render prompts -> ${dir}/README.md`);
  if (existsSync(path.join(dir, "production-pack.md"))) console.warn(`${slug}: ${dir}/production-pack.md is left from an older baselines export; approve from the report files instead.`);
  if (!freeze) return true;
  const approvals = approvalsSchema.parse(JSON.parse(await readFile(path.join("public", "demo", "approvals.json"), "utf8")));
  const result = await freezeReportPacks(slug, approvals);
  for (const file of result.written) console.log(`${slug}: frozen ${file}`);
  for (const { key, missing } of result.refused) {
    console.error(`${slug}/${key}: not frozen, ${missing.length} hash(es) not in public/demo/approvals.json "prompts":`);
    for (const h of missing) console.error(`  ${h.promptHash} ${h.id}`);
  }
  return result.refused.length === 0;
}

const USAGE = ["Usage:", "  npm run prompts:export -- <slug>|--all-examples [--from-report] [--freeze]", "  npm run prompts:export -- <slug>|--all [--freeze] [--baseline]"].join("\n");

async function main(): Promise<void> {
  let parsed: CliArgs;
  try {
    parsed = parseCliArgs(process.argv.slice(2), { flags: ["--all", "--all-examples", "--from-report", "--freeze", "--baseline"], options: [], positionals: { min: 0, max: 1 } });
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const has = (flag: string) => parsed.flags.has(flag);
  const [slug] = parsed.positional;
  const all = has("--all");
  const freeze = has("--freeze");
  const allExamples = has("--all-examples");
  const baseline = has("--baseline");
  if (slug && (all || allExamples)) fail(`Pass a slug or ${all ? "--all" : "--all-examples"}, not both.\n${USAGE}`);
  if (all && allExamples) fail(`Pass --all or --all-examples, not both.\n${USAGE}`);
  if (baseline && (has("--from-report") || allExamples)) fail(`--baseline exports the older Control; it does not go with --from-report or --all-examples.\n${USAGE}`);
  // An example exports from its report unless --baseline asks for its older Control.
  if (has("--from-report") || allExamples || (slug && isExampleSlug(slug) && !baseline)) {
    if (!slug && !allExamples) fail("Usage: npm run prompts:export -- <slug>|--all-examples --from-report [--freeze]");
    if (freeze && allExamples) fail("--freeze takes one slug at a time, after the founder approves that example's packs.");
    if (slug && !isExampleSlug(slug)) fail(`"${slug}" is not an example. Examples: ${EXAMPLES.map((e) => e.slug).join(", ")}`);
    const targets: ExampleSlug[] = allExamples ? EXAMPLES.map((e) => e.slug) : [slug as ExampleSlug];
    let ok = true;
    for (const target of targets) ok = (await exportReport(target, freeze)) && ok;
    if (!ok) process.exit(1);
    return;
  }
  if (!slug && !all) fail("Usage: npm run prompts:export -- <slug>|--all [--freeze] [--baseline]");
  if (freeze && all) fail("--freeze takes one slug at a time, after the founder approves that pack.");
  const targets = all ? CANDIDATES.filter((c) => !isExampleSlug(c.slug)) : CANDIDATES.filter((c) => c.slug === slug);
  if (all) console.log(`Skipping the examples (${EXAMPLES.map((e) => e.slug).join(", ")}): they export from their reports (--all-examples). Pass <slug> --baseline for an example's older Control.`);
  if (targets.length === 0) fail(`Unknown candidate "${slug}". Known: ${CANDIDATES.map((c) => c.slug).join(", ")}`);
  let ok = true;
  for (const candidate of targets) ok = (await exportOne(candidate, freeze)) && ok;
  if (!ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  void main();
}
