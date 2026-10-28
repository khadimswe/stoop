// Records the founder's approval of an example store's poster background and its posts.
//   npx tsx scripts/approve-poster.ts <slug> <draft-file> [--by founder] [--date YYYY-MM-DD] [--plans <dir>]
// It checks the draft (listed in marketing.json, its sha256 unchanged, rendered from the frozen prompt,
// which passes the poster check), then writes:
//   data/plans/<slug>/marketing/approved.json   { file, sha256, promptHash, approvedAt, by, variantB? }
//   data/plans/<slug>/plan.events.json          + poster.updated (ready) and posts.ready after run.done
//   data/plans/<slug>/plan.report.json          reduced again from those events (the golden test)
//   data/plans/<slug>/marketing/marketing.json  the poster payload marked ready
// No recorded plan event changes. The poster route then draws the example over the approved file,
// read from the traced data/plans folder and checked by its sha256. Zero API calls, zero renders.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError, parseCliArgs } from "../lib/cli-args";
import { planExampleSlug } from "../lib/plan/example-list";
import { planEventSchema, reducePlan, toPlanReport } from "../lib/plan/events";
import { APPROVAL_FILE, approvalSchema, sha256Of } from "../lib/plan/poster-approval";
import { approvalProblems, approvalRecord, approvedPoster, withApprovedMarketing } from "../lib/plan/poster-approve";
import { marketingExportSchema, marketingMarkdown } from "../lib/plan/posts-export";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The recorder's JSON format (scripts/record-plan-example.ts), so a diff shows only what changed. */
const json = (value: unknown) => `${JSON.stringify(value, null, 2).replace(/\u2014/g, "\\u2014")}\n`;

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2), { flags: [], options: ["--by", "--date", "--plans"], positionals: { min: 2, max: 2 } });
  } catch (error) {
    fail(error instanceof CliError ? `${error.message}\nUsage: npx tsx scripts/approve-poster.ts <slug> <draft-file> [--by founder] [--date YYYY-MM-DD] [--plans <dir>]` : String(error));
  }
  const [slug, file] = args.positional as [string, string];
  if (!planExampleSlug(`ex-${slug}`)) fail(`"${slug}" is not an example store.`);
  const plansDir = path.resolve(args.options.get("--plans") ?? path.join(process.cwd(), "data", "plans"));
  const dir = path.join(plansDir, slug, "marketing");
  const jsonFile = path.join(dir, "marketing.json");
  const eventsFile = path.join(plansDir, slug, "plan.events.json");
  if (!existsSync(jsonFile)) fail(`No ${jsonFile}. Run scripts/export-marketing.ts first.`);
  if (!/^poster-bg-[0-9a-f]{12}\.(?:png|jpg|webp)$/.test(file) || !existsSync(path.join(dir, file))) fail(`No draft ${file} in ${dir}.`);

  const exported = marketingExportSchema.parse(JSON.parse(await readFile(jsonFile, "utf8")));
  const events = planEventSchema.array().parse(JSON.parse(await readFile(eventsFile, "utf8")));
  const report = toPlanReport(reducePlan(events));
  const input = {
    exported,
    file,
    fileSha256: sha256Of(new Uint8Array(await readFile(path.join(dir, file)))),
    report,
    by: args.options.get("--by") ?? "founder",
    approvedAt: args.options.get("--date") ?? new Date().toISOString().slice(0, 10),
  };
  const problems = approvalProblems(input);
  if (problems.length) fail(`${slug}: not approved.\n${problems.map((p) => `- ${p}`).join("\n")}`);

  const approval = approvalSchema.parse(approvalRecord(input));
  const approvedEvents = planEventSchema.array().parse(withApprovedMarketing(events, exported, `${input.approvedAt}T12:00:00.000Z`));
  const approvedReport = toPlanReport(reducePlan(approvedEvents));
  const marketing = marketingExportSchema.parse({ ...exported, events: [{ type: "poster.updated", poster: approvedPoster(exported.events[0].poster) }, exported.events[1]] });

  await writeFile(path.join(dir, APPROVAL_FILE), json(approval));
  await writeFile(eventsFile, json(approvedEvents));
  await writeFile(path.join(plansDir, slug, "plan.report.json"), json(approvedReport));
  await writeFile(jsonFile, json(marketing));
  await writeFile(path.join(dir, "marketing.md"), marketingMarkdown(approvedReport, marketing));
  console.log(`${slug}: approved ${file} (sha256 ${approval.sha256.slice(0, 12)}) by ${approval.by} on ${approval.approvedAt}; the poster and posts are on the example's events.`);
}

main().catch((error: unknown) => fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error)));
