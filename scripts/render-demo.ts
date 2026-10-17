// The examples' demo media, made offline by the founder only (no public route ever runs this). Every
// command that spends refuses an unapproved prompt hash, prints the prompts, hashes, model and estimated
// cost first, renders nothing without --yes and nothing at all with --dry-run, and stops at 24 images
// per invocation. An approved file is never rendered over without --replace. Approvals stay hand-edited
// in public/demo/approvals.json; this never writes it.
//
//   npm run render:demo -- packshot <slug> [--dry-run] [--yes] [--replace]
//   npm run render:demo -- storyboards <slug> [--segment <id>|--control] [--dry-run] [--yes] [--replace]
//   npm run render:demo -- clip <file> --example <slug> --role <role> [--segment <id>] --prompt-hash <hash> [--poster <image>] [--captions <vtt>] [--dry-run] [--replace]
//   npm run render:demo -- approve-list <slug>
//
// Order: export and review (npm run prompts:export -- <slug> --from-report), approve the pack hashes,
// packshot, approve its file, storyboards (their prompts pin the approved packshot), approve the frame
// files and any rewrite hashes, then register the founder's Higgsfield clips.
// Keys (FAL_KEY, ANTHROPIC_API_KEY) are read from the local env file only when --yes renders.
import path from "node:path";
import { stoopModel, stoopModelId } from "../lib/agent/model";
import { approveList, clipCommand, DemoRefusal, falRenderers, packshotCommand, storyboardsCommand, type DemoDeps, type SpendFlags } from "../lib/demo/render-demo";
import { loadLocalEnv } from "./env";

const USAGE = [
  "Usage:",
  "  npm run render:demo -- packshot <slug> [--dry-run] [--yes] [--replace]",
  "  npm run render:demo -- storyboards <slug> [--segment <id>|--control] [--dry-run] [--yes] [--replace]",
  "  npm run render:demo -- clip <file> --example <slug> --role <hero-control|hero-culture|control|culture> [--segment <id>] --prompt-hash <hash> [--poster <image>] [--captions <vtt>] [--dry-run] [--replace]",
  "  npm run render:demo -- approve-list <slug>",
].join("\n");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** What each command accepts: flags, and options that take a value. Anything else fails, so a typo never widens a render. */
const ACCEPTS: Record<string, { flags: string[]; options: string[] }> = {
  packshot: { flags: ["--dry-run", "--yes", "--replace"], options: [] },
  storyboards: { flags: ["--dry-run", "--yes", "--replace", "--control"], options: ["--segment"] },
  clip: { flags: ["--dry-run", "--replace"], options: ["--example", "--role", "--segment", "--prompt-hash", "--poster", "--captions"] },
  "approve-list": { flags: [], options: [] },
};

function parseArgs(command: string, argv: readonly string[]): { positional: string[]; options: Map<string, string>; flags: Set<string> } {
  const accepts = ACCEPTS[command];
  if (!accepts) fail(USAGE);
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (accepts.flags.includes(arg)) flags.add(arg);
    else if (accepts.options.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value.\n${USAGE}`);
      options.set(arg, value);
      i++;
    } else if (arg.startsWith("--")) fail(`${command} does not take ${arg}.\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) fail(`${command} takes exactly one ${command === "clip" ? "file" : "slug"}.\n${USAGE}`);
  return { positional, options, flags };
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
  switch (command) {
    case "packshot": {
      const [slug] = positional;
      if (!slug) fail(USAGE);
      await packshotCommand({ ...base, ...liveDeps(live, false) }, slug, spend);
      return;
    }
    case "storyboards": {
      const [slug] = positional;
      if (!slug) fail(USAGE);
      await storyboardsCommand({ ...base, ...liveDeps(live, true) }, slug, { segment: options.get("--segment") ?? null, control: flags.has("--control") }, spend);
      return;
    }
    case "clip": {
      const [file] = positional;
      const example = options.get("--example");
      const role = options.get("--role");
      const promptHash = options.get("--prompt-hash");
      if (!file || !example || !role || !promptHash) fail(USAGE);
      await clipCommand({ ...base, renderers: null, model: null }, { file, example, role, segment: options.get("--segment") ?? null, promptHash, poster: options.get("--poster") ?? null, captions: options.get("--captions") ?? null, dryRun: spend.dryRun, replace: spend.replace });
      return;
    }
    case "approve-list": {
      const [slug] = positional;
      if (!slug) fail(USAGE);
      for (const line of await approveList(base, slug)) console.log(line);
      return;
    }
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
