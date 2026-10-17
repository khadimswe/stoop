// The review files for one example, built from its recorded report (the source of truth for demo
// approvals since Oct 17): for the Control and each world, the brief with its origins and receipts,
// the concepts with rubric scores, every asset and render prompt with its hash, the shot list, the kit
// scripts and captions, the critique checklist, the Director's Guide and the disclosure; then an index
// with the demo packshot prompt, and hashes.json, the list the founder approves from. Every file opens
// with "Status: not approved". Pure: scripts/export-pack.ts writes the files to exports/<slug>/.
import type { Evidence } from "../evidence";
import type { BriefSlots } from "../prompts/brief";
import { packHashes } from "../prompts/pack";
import { pickUgcFormat } from "../prompts/ugc";
import type { Report } from "../report/schema";
import type { CultureSource } from "../report/world";
import { ageBandLabel, type Cue } from "../types";
import { exportHashes, packshotPlan, sizeLabel, usd } from "./demo-renders";
import { EXAMPLES } from "./examples";
import { block, conceptLines, hashLines, packLines } from "./pack-markdown";
import { reportFile, reportPacks, type ReportPack } from "./report-packs";

export const NOT_APPROVED = "Status: not approved";

/** Qloo's own names may carry an em dash; review files show it as a hyphen. */
const plain = (text: string) => text.replace(/\s*\u2014\s*/g, " - ");

const originLabel = (cue: Cue) => (cue.origin === "creative" ? "creative, not from Qloo" : cue.origin === "yours" ? "your choice" : cue.origin);
const receipts = (ids: readonly string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");
const cueLine = (label: string, cue: Cue | null, none: string) => (cue ? `- ${label} (${originLabel(cue)}): ${cue.text}${receipts(cue.evidenceIds)}` : `- ${label}: ${none}`);

function sourceLine(source: CultureSource): string {
  const position = source.position ? `, beats ${source.position.beats} of ${source.position.of} reference items` : "";
  const why = source.why.length ? `; why: ${source.why.map(plain).join("; ")}` : "";
  return `  - ${plain(source.name)} (${source.type.replace(/^urn:/, "")}, #${source.rank} in its call${position}${why})${receipts(source.evidenceIds)}`;
}

function briefLines(brief: BriefSlots): string[] {
  return [
    `- Segment: ${brief.segment.label} (${brief.segment.ageBands.map(ageBandLabel).join(", ")})`,
    cueLine("Product role", brief.productRole, "none"),
    cueLine("Mood", brief.mood, "none"),
    cueLine("Music", brief.music, "none"),
    cueLine("Visual language", brief.visual, "none"),
    cueLine("Wardrobe", brief.wardrobe, "none"),
    ...brief.setting.map((cue, i) => cueLine(`Setting ${i + 1}`, cue, "none")),
    cueLine("Voice", brief.voice.tone, "none"),
    `  - Use: ${brief.voice.use.join("; ") || "-"}`,
    `  - Avoid: ${brief.voice.avoid.join("; ") || "-"}`,
    cueLine("Talent", brief.talent, "none (no people on screen)"),
    `- Hooks: ${brief.hooks.length ? brief.hooks.map((cue) => `"${cue.text}" (${originLabel(cue)})`).join(" / ") : "-"}`,
    `- Places a prompt may name: ${brief.allowedPlaces.length ? brief.allowedPlaces.join(", ") : "none"}`,
  ];
}

/** Every receipt the lines cite, from the report's ledger. */
function receiptLines(text: string, ledger: ReadonlyMap<string, Evidence>): string[] {
  const ids = [...new Set(text.match(/\bev_[0-9a-f]{12}\b/g) ?? [])].sort();
  if (ids.length === 0) return [];
  return [
    "## Receipts cited above",
    "",
    ...ids.map((id) => {
      const e = ledger.get(id);
      return e ? `- ${id}: ${plain(e.label ?? "Qloo call")} (${e.endpoint}, ${e.cached ? "cached" : "live"}, ${e.fetchedAt.slice(0, 10)})` : `- ${id}: not in the ledger`;
    }),
    "",
  ];
}

function packMarkdown(report: Report, entry: ReportPack, brandName: string): string {
  const { pack } = entry;
  const product = report.inputs.product;
  const isControl = entry.segmentId === null;
  const control = report.control;
  const head: string[] = [
    `# Production Pack: ${brandName}, ${product.name}. ${isControl ? "The Control" : `World: ${entry.label}`}`,
    "",
    `**${NOT_APPROVED}.** Review every prompt before any render. Approve by adding the hashes you approve (listed at the end, and in \`hashes.json\`) to \`public/demo/approvals.json\` under "prompts".`,
    "",
    `Source: the recorded example report \`${reportFile(product.slug)}\` (${report.meta.id}, recorded ${report.meta.createdAt}). This is the pack the report shows; the demo clips are approved from it.`,
    "",
    isControl
      ? "This is the **Control**: an LLM-only brief written with no Qloo data. It uses the same concept writer, templates, models and settings as the culture-made packs; only the brief differs."
      : `This world's ingredients come from Qloo (origin \`qloo\`) or are worded from Qloo items (\`interpreted\`), each with its receipts. \`creative\` means not from Qloo.`,
    "",
    `- Template version ${pack.templateVersion}. Settings hash \`${pack.settingsHash}\`. Models: images ${pack.settings.models.image}, multi-shot ${pack.settings.models.multiShot}, per scene ${pack.settings.models.perScene ?? "none"}.`,
    `- Creative direction: look ${pack.settings.direction.look}, cast ${pack.settings.direction.cast} (resolved: ${pack.cast}), energy ${pack.settings.direction.energy}${pack.settings.direction.notes ? `, notes "${pack.settings.direction.notes}"` : ""}.`,
    entry.concepts ? `- Concepts written by ${entry.concepts.modelId}.` : "- No concepts recorded.",
    "",
    "## Product",
    "",
    `- ${brandName}: ${product.name}. ${product.oneLine}`,
    `- Seller facts: ${product.sellerFacts ?? "none given"}`,
    ...(product.source.kind === "description" ? [`- Look (for the packshot): ${product.source.lookDescription}`] : []),
    `- Qloo measured from these seeds: ${report.inputs.seeds.map((s) => `${plain(s.ref.name)} (${s.origin})`).join(", ") || "none"}`,
    `- Stated customer: ${report.inputs.statedCustomer?.trim().replace(/[.!?]+$/, "") || "not stated"}. Region: ${report.inputs.region}.`,
    "",
  ];
  if (isControl && control) {
    head.push(
      "## What the LLM-only brief assumed",
      "",
      `- Age bands: ${control.assumed.ageBands.map(ageBandLabel).join(", ") || "-"}. Cities: ${control.assumed.cities.join(", ") || "-"} (never in any prompt).`,
      ...control.fits.map((fit) => `- Against ${report.worlds.find((w) => w.segmentId === fit.segmentId)?.label ?? fit.segmentId}: ${fit.line}`),
      "",
    );
  } else {
    head.push("## Culture Brief (what Qloo decided)", "");
    if (entry.settingCity) head.push(`- Setting city: ${entry.settingCity.label} (#${entry.settingCity.audienceRank} of the audience's cities)${receipts(entry.settingCity.evidenceIds)}`);
    head.push(`- Fields Qloo backed richly: ${entry.richSlots.length ? entry.richSlots.join(", ") : "none"}`, "");
    for (const field of entry.culture ?? []) {
      head.push(`### ${field.field} (${field.signal === "none" ? "No Qloo signal" : `${field.signal} signal`}${field.scope === "audience" ? ", whole audience" : ""})`, "");
      if (field.sources.length) head.push("- Qloo sources:", ...field.sources.map(sourceLine));
      head.push(...(field.cues.length ? field.cues.map((cue) => `- Cue (${originLabel(cue)}): ${cue.text}${receipts(cue.evidenceIds)}`) : ["- No cue."]), "");
    }
  }
  head.push("## The brief, slot by slot (with origins)", "", ...briefLines(entry.brief), "");

  const kit = entry.kit ?? { ugc: [], captions: null };
  const tail: string[] = [
    "## Critique checklist (storyboard frames and clips)",
    "",
    ...pack.checklist.map((item) => `- [ ] ${item.text} (${item.appliesTo.join(" and ")}${item.blocking ? ", blocking" : ""})`),
    "",
    "## AI disclosure",
    "",
    pack.disclosure,
    "",
  ];
  const body = [...head, ...(entry.concepts ? conceptLines(entry.concepts) : ["## Concepts", "", "None recorded.", ""]), ...packLines(pack, kit, pickUgcFormat(pack.concept).reason), ...tail];
  const ledger = new Map(report.ledger.map((e) => [e.id, e]));
  return [...body, ...receiptLines(body.join("\n"), ledger), ...hashLines(packHashes(pack))].join("\n");
}

function readme(report: Report, entries: readonly ReportPack[], brandName: string): string {
  const slug = report.inputs.product.slug;
  const packshot = packshotPlan(report);
  return [
    `# ${brandName}: Production Packs for the demo media`,
    "",
    `**${NOT_APPROVED}.** Nothing here may be rendered until the founder has read it and added the approved hashes to \`public/demo/approvals.json\`.`,
    "",
    `Source: \`${reportFile(slug)}\` (${report.meta.id}). The founder decided on Oct 17 that demo clips are approved from the report's packs.`,
    "",
    "## Files",
    "",
    ...entries.map((e) => `- \`${e.key}.md\`: ${e.segmentId === null ? "the Control" : `world "${e.label}"`}, ${e.pack.assets.length} asset prompts, ${e.pack.renders.length} render prompts`),
    "- `hashes.json`: every prompt hash in these files, for `approvals.json` \"prompts\"",
    "",
    "## Order",
    "",
    "1. Read every pack file and its receipts.",
    `2. Approve: copy the hashes you approve into \`public/demo/approvals.json\` "prompts". Freeze the approved packs: \`npm run prompts:export -- ${slug} --from-report --freeze\`.`,
    `3. Packshot: \`npm run render:demo -- packshot ${slug} --dry-run\`, then \`--yes\`. View it, then approve its file hash (\`npm run render:demo -- approve-list ${slug}\`).`,
    `4. Storyboards: \`npm run render:demo -- storyboards ${slug} --dry-run\` prints the frame prompts and hashes (they pin the approved packshot file). Approve them, then \`--yes\`: Claude reviews the frames and its rewrites are only recorded, in \`pending-rewrites.json\`. View the frames and approve their files (\`approve-list\`); approve the rewrites you want, then \`storyboards ${slug} --rerender --yes\` renders those, one per scene, and you approve the new files.`,
    `5. Clips: render in Higgsfield from the approved render prompts, following the Director's Guide, then register each one: \`npm run render:demo -- clip <file> --example ${slug} --role <role> [--segment <id>] --prompt-hash <hash>\`.`,
    "",
    "## Demo renders on fal (offline, founder only)",
    "",
    `### ${packshot.file.split("/").pop()} (the reference image for the storyboards)`,
    "",
    `- Model: ${packshot.model.displayName} (\`${packshot.model.endpoint}\`), ${sizeLabel(packshot.imageSize)}, ${packshot.format} as fal sends it (never re-encoded), text to image. Estimated ${usd(packshot.usd)}.`,
    `- From the packs' \`${packshot.asset.file}\` asset (promptHash \`${packshot.asset.promptHash}\`). Served at \`${packshot.file}\`.`,
    `- promptHash: \`${packshot.promptHash}\``,
    "",
    block(packshot.prompt),
    "",
    "### Storyboards",
    "",
    `Up to 4 frames per pack, from the live frame template. Their prompts and hashes print with \`npm run render:demo -- storyboards ${slug} --dry-run\`: with an approved packshot they use it as the reference image, so they are approved after it.`,
    "",
  ].join("\n");
}

export interface ExportFile {
  /** Relative to exports/<slug>/. */
  name: string;
  text: string;
}

export function reportExport(report: Report): ExportFile[] {
  const slug = report.inputs.product.slug;
  const brandName = report.inputs.product.brandName ?? EXAMPLES.find((e) => e.slug === slug)?.brandName ?? slug;
  const entries = reportPacks(report);
  const hashes = {
    status: NOT_APPROVED,
    note: "Approve by copying the hashes you approve from \"prompts\" into public/demo/approvals.json \"prompts\". Never approve a prompt you have not read.",
    example: slug,
    source: reportFile(slug),
    packs: entries.map((e) => ({ key: e.key, file: `${e.key}.md`, hashes: packHashes(e.pack) })),
    demo: [{ id: `${slug}/demo/${packshotPlan(report).file.split("/").pop()}`, endpoint: packshotPlan(report).model.endpoint, promptHash: packshotPlan(report).promptHash }],
    prompts: exportHashes(report).map((h) => h.promptHash),
  };
  return [
    { name: "README.md", text: readme(report, entries, brandName) },
    ...entries.map((entry) => ({ name: `${entry.key}.md`, text: packMarkdown(report, entry, brandName) })),
    { name: "hashes.json", text: `${JSON.stringify(hashes, null, 2)}\n` },
  ];
}
