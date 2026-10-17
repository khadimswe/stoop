// The examples' demo media, made offline by the founder only (no public route ever runs this). Nothing
// renders a prompt hash that is not in public/demo/approvals.json. Every command that spends prints the
// prompts, hashes, model and estimated cost first, renders nothing without --yes and nothing at all with
// --dry-run, and stops at 16 images per invocation. An approved file is never rendered over without
// --replace. fal's bytes are written as they come. Approvals stay hand-edited; this never writes them.
//
//   npm run render:demo -- packshot <slug> [--dry-run] [--yes] [--replace]
//   npm run render:demo -- storyboards <slug> [--segment <id>|--control] [--rerender] [--dry-run] [--yes] [--replace]
//   npm run render:demo -- clip <file> --example <slug> --role <role> [--segment <id>] --prompt-hash <hash> [--poster <image>] [--captions <vtt>] [--dry-run] [--replace]
//   npm run render:demo -- approve-list <slug>
//
// Order: export and review (npm run prompts:export -- <slug>), approve the pack hashes, packshot,
// approve its file, storyboards (their prompts pin the approved packshot; Claude's rewrites are only
// recorded in exports/<slug>/pending-rewrites.json), approve the frame files and the rewrites you want,
// storyboards --rerender for those, approve the new files, then register the founder's Higgsfield clips.
// Keys (FAL_KEY, ANTHROPIC_API_KEY) are read from the local env file only when --yes renders.
import path from "node:path";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { parseCliArgs, type CliArgs, type CliSpec } from "../lib/cli-args";
import { approveList, clipCommand, DemoRefusal, falRenderers, packshotCommand, rerenderCommand, storyboardsCommand, type DemoDeps, type SpendFlags } from "../lib/demo/render-demo";
import { loadLocalEnv } from "./env";

const USAGE = [
  "Usage:",
  "  npm run render:demo -- packshot <slug> [--dry-run] [--yes] [--replace]",
  "  npm run render:demo -- storyboards <slug> [--segment <id>|--control] [--rerender] [--dry-run] [--yes] [--replace]",
  "  npm run render:demo -- clip <file> --example <slug> --role <hero-control|hero-culture|control|culture> [--segment <id>] --prompt-hash <hash> [--poster <image>] [--captions <vtt>] [--dry-run] [--replace]",
  "  npm run render:demo -- approve-list <slug>",
].join("\n");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** What each command accepts (lib/cli-args.ts refuses anything else, so a typo never widens a render). */
const ACCEPTS: Record<string, CliSpec> = {
  packshot: { flags: ["--dry-run", "--yes", "--replace"], options: [], positionals: { min: 1, max: 1 } },
  storyboards: { flags: ["--dry-run", "--yes", "--replace", "--control", "--rerender"], options: ["--segment"], positionals: { min: 1, max: 1 } },
  clip: { flags: ["--dry-run", "--replace"], options: ["--example", "--role", "--segment", "--prompt-hash", "--poster", "--captions"], positionals: { min: 1, max: 1 } },
  "approve-list": { flags: [], options: [], positionals: { min: 1, max: 1 } },
};

function parseArgs(command: string, argv: readonly string[]): CliArgs {
  const spec = ACCEPTS[command];
  if (!spec) fail(USAGE);
  try {
    return parseCliArgs(argv, spec);
  } catch (error) {
    fail(`${command}: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
}

/**
 * fal and Claude, only for a --yes run. A missing key leaves its side null: the command then refuses,
 * after its approval checks, without rendering anything.
 */
function liveDeps(spend: boolean, needsModel: boolean): Pick<DemoDeps, "renderers" | "model"> {
  if (!spend) return { renderers: null, model: null };
  loadLocalEnv();
  const falKey = process.env.FAL_KEY?.trim();
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  return { renderers: falKey ? falRenderers(falKey) : null, model: needsModel && hasClaude ? stoopModel(stoopModelId()) : null };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) fail(USAGE);
  const { positional, options, flags } = parseArgs(command, rest);
  const spend: SpendFlags = { dryRun: flags.has("--dry-run"), yes: flags.has("--yes"), replace: flags.has("--replace") };
  const live = spend.yes && !spend.dryRun;
  const base = { root: process.cwd(), log: (line: string) => console.log(line) };
  const [target] = positional;
  switch (command) {
    case "packshot":
      await packshotCommand({ ...base, ...liveDeps(live, false) }, target, spend);
      return;
    case "storyboards": {
      const select = { segment: options.get("--segment") ?? null, control: flags.has("--control") };
      // A re-render takes no review: only the first pass calls Claude.
      if (flags.has("--rerender")) await rerenderCommand({ ...base, ...liveDeps(live, false) }, target, select, spend);
      else await storyboardsCommand({ ...base, ...liveDeps(live, true) }, target, select, spend);
      return;
    }
    case "clip": {
      const example = options.get("--example");
      const role = options.get("--role");
      const promptHash = options.get("--prompt-hash");
      if (!example || !role || !promptHash) fail(USAGE);
      await clipCommand({ ...base, renderers: null, model: null }, { file: target, example, role, segment: options.get("--segment") ?? null, promptHash, poster: options.get("--poster") ?? null, captions: options.get("--captions") ?? null, dryRun: spend.dryRun, replace: spend.replace });
      return;
    }
    case "approve-list":
      for (const line of await approveList(base, target)) console.log(line);
      return;
    default:
      fail(USAGE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    if (error instanceof DemoRefusal) fail(error.message);
    // Vendor errors can echo a request; print the kind and message only, never a key.
    fail(`render-demo failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  });
}
