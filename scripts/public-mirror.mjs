// Keeps Qloo response data out of the public mirror of this repository. Qloo's hackathon developer
// guide asks that its response data never be stored in a public repository, so the mirror is this
// repository's history with every path and old file version in public-mirror.exclude removed.
//
//   node scripts/public-mirror.mjs check [--history] [--names-from <dir>]      (npm run check:public)
//       For a filtered tree (the mirror). Fails when an excluded path exists (on disk, tracked, or with
//       --history in any commit), when a text file holds a Qloo-like entity id (a UUID, any case)
//       other than the synthetic test ids below, or, with --names-from <dir> (the working
//       repository's recorded fixtures), when a text file names an entity Qloo returned.
//   node scripts/public-mirror.mjs scan [--names-from <dir>]
//       For the working repository. Lists what the filter would keep that still looks like Qloo data:
//       file versions in history to add to public-mirror.exclude as blob: lines, and files in the
//       current tree to fix (never strip a current version: the file would vanish from the mirror).
//   node scripts/public-mirror.mjs filter-args <dir>
//       Writes <dir>/paths.txt and <dir>/blobs.txt for git filter-repo (--paths-from-file with
//       --invert-paths, and --strip-blobs-with-ids).
//
// Node built-ins only, so it runs before `npm ci` and in the filtered copy alike.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const EXCLUDE_FILE = "public-mirror.exclude";

/** Made-up entity ids the tests use. Anything else shaped like a UUID could be a real Qloo id. */
export const SYNTHETIC_IDS = new Set(
  [
    "AFBD8046-1234-4ABC-9DEF-0123456789AB",
    "0C1D2E3F-4A5B-4C6D-8E7F-9A0B1C2D3E4F",
    "11111111-2222-4333-8444-555555555555",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ].map((id) => id.toUpperCase()),
);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Never walked on disk: git's own folder, installed packages and build output. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next"]);

// --- The exclude file ---------------------------------------------------------------------------

/**
 * Python's fnmatch for paths, as git filter-repo uses it: the whole path must match, `*` crosses
 * slashes and `?` is one character. Character sets are refused: fnmatch reads `[^...]` and `[]...]`
 * differently from a JavaScript class, and a mismatch could keep a file this check thinks is gone.
 */
function globToRegExp(glob) {
  if (glob.includes("[")) throw new Error(`glob:${glob}: character sets are not supported here. Use a regex: line instead.`);
  const out = [...glob].map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|\\/\]]/g, "\\$&"))).join("");
  return new RegExp(`^(?:${out})$`, "s");
}

/** git filter-repo's literal match: the path itself, or anything under it as a directory. */
const literalMatches = (literal, file) =>
  literal === "" || (file.startsWith(literal) && (literal.endsWith("/") || file.length === literal.length || file[literal.length] === "/"));

/** One path line, matched the way git filter-repo matches it (literal prefix, glob, or regex search). */
export function pathRule(line) {
  if (line.startsWith("regex:")) {
    const re = new RegExp(line.slice(6));
    return { line, test: (file) => re.test(file) };
  }
  if (line.startsWith("glob:")) {
    const glob = line.slice(5);
    const patterns = [globToRegExp(glob)];
    // filter-repo also matches a non-* glob as a directory (glob/*).
    if (!glob.endsWith("*")) patterns.push(globToRegExp(glob + (glob.endsWith("/") ? "*" : "/*")));
    return { line, test: (file) => patterns.some((re) => re.test(file)) };
  }
  const literal = line.startsWith("literal:") ? line.slice(8) : line;
  return { line, test: (file) => literalMatches(literal, file) };
}

/** Path rules, the blob ids to strip (with the path each had) and names the name check allows. */
export function readExclude(file = EXCLUDE_FILE) {
  const rules = [];
  const blobs = new Map();
  const allowNames = new Set();
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("blob:")) {
      const [sha, ...rest] = line.slice(5).trim().split(/\s+/);
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${file}: "${line}" needs a full 40-character blob id.`);
      blobs.set(sha, rest.join(" "));
    } else if (line.startsWith("allow-name:")) allowNames.add(line.slice(11).trim());
    else if (line.includes("==>")) throw new Error(`${file}: renames are not allowed ("${line}").`);
    else rules.push(pathRule(line));
  }
  return { rules, blobs, allowNames, excluded: (p) => rules.some((r) => r.test(p)) };
}

// --- Git and the file system --------------------------------------------------------------------

const git = (args, input) => execFileSync("git", args, { input, maxBuffer: 1 << 30 });

function trackedFiles() {
  return git(["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
}

function filesOnDisk(dir = ".", out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) filesOnDisk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every (path, blob) pair in every commit reachable from `refs` (rev-list arguments). */
function historyEntries(refs = ["--all"]) {
  const commits = git(["rev-list", ...refs]).toString().split("\n").filter(Boolean);
  const blobs = new Map();
  const paths = new Set();
  for (const commit of commits) {
    for (const entry of git(["ls-tree", "-r", "-z", commit]).toString("utf8").split("\0")) {
      if (!entry) continue;
      const tab = entry.indexOf("\t");
      const [, type, sha] = entry.slice(0, tab).split(" ");
      const file = entry.slice(tab + 1);
      paths.add(file);
      if (type !== "blob") continue;
      if (!blobs.has(sha)) blobs.set(sha, new Set());
      blobs.get(sha).add(file);
    }
  }
  return { commits: commits.length, paths, blobs };
}

/** Blob contents for many ids in one `git cat-file --batch`. */
function readBlobs(shas) {
  const out = new Map();
  if (shas.length === 0) return out;
  const data = git(["cat-file", "--batch"], `${shas.join("\n")}\n`);
  let at = 0;
  while (at < data.length) {
    const nl = data.indexOf(10, at);
    const [sha, , size] = data.subarray(at, nl).toString().split(" ");
    const start = nl + 1;
    out.set(sha, data.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return out;
}

const textOf = (buffer) => (buffer.includes(0) ? null : buffer.toString("utf8"));

// --- What looks like Qloo data ------------------------------------------------------------------

/** UUID-shaped strings in `text` (any case) that are not one of the synthetic test ids. */
export function idsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(UUID)) if (!SYNTHETIC_IDS.has(match[0].toUpperCase())) found.add(match[0]);
  return [...found];
}

const TOKEN = /[\p{L}\p{N}]+/gu;
const firstToken = (name) => name.match(/[\p{L}\p{N}]+/u);
const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Every entity name in the recorded fixtures under `dir` (objects with an entity_id). */
function fixtureEntityNames(dir) {
  const names = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === "object") {
      if (typeof value.name === "string" && typeof value.entity_id === "string") names.add(value.name.trim());
      for (const v of Object.values(value)) walk(v);
    }
  };
  for (const file of readdirSync(dir)) {
    const full = path.join(dir, file);
    if (!statSync(full).isFile()) continue;
    if (file.endsWith(".json.gz")) walk(JSON.parse(gunzipSync(readFileSync(full)).toString("utf8")));
    else if (file.endsWith(".json")) walk(JSON.parse(readFileSync(full, "utf8")));
  }
  return names;
}

/** Text Stoop wrote itself: the candidates' seeds and copy, the LLM-only briefs and the Census metro names. */
function ourOwnText() {
  const files = ["data/candidates.json", "data/geo/us-metros.json"];
  if (existsSync("data/baselines")) for (const f of filesOnDisk("data/baselines")) files.push(f);
  return files.filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8")).join("\n").toLowerCase();
}

/**
 * A name finder for the entity names that could only have come from Qloo: at least 6 characters, more
 * than one word (or a symbol, digit or inner capital), and not in Stoop's own inputs.
 */
function nameFinder(dir, allowNames) {
  const ours = ourOwnText();
  const byToken = new Map();
  let count = 0;
  for (const name of fixtureEntityNames(dir)) {
    if (name.length < 6 || allowNames.has(name)) continue;
    if (!(/\s/.test(name) || /[^\p{L}]/u.test(name.slice(1)) || /\p{Lu}/u.test(name.slice(1)))) continue;
    if (ours.includes(name.toLowerCase())) continue;
    const token = firstToken(name);
    if (!token) continue;
    const list = byToken.get(token[0]) ?? [];
    list.push({ name, offset: token.index });
    byToken.set(token[0], list);
    count++;
  }
  const find = (text) => {
    const found = new Set();
    for (const match of text.matchAll(TOKEN)) {
      for (const { name, offset } of byToken.get(match[0]) ?? []) {
        const start = match.index - offset;
        if (start < 0 || !text.startsWith(name, start)) continue;
        if (isWordChar(text[start - 1]) || isWordChar(text[start + name.length])) continue;
        found.add(name);
      }
    }
    return [...found];
  };
  return { count, find };
}

// --- Commands -----------------------------------------------------------------------------------

function option(args, flag) {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

/** Problems in text: Qloo-like ids and, with a name finder, entity names Qloo returned. */
function textProblems(text, names) {
  const problems = [];
  const ids = idsIn(text);
  if (ids.length) problems.push(`${ids.length} Qloo-like entity id${ids.length === 1 ? "" : "s"} (${ids.slice(0, 2).join(", ")})`);
  const found = names ? names.find(text) : [];
  if (found.length) problems.push(`${found.length} entity name${found.length === 1 ? "" : "s"} Qloo returned (${found.slice(0, 3).map((n) => `"${n}"`).join(", ")})`);
  return problems;
}

function check(args) {
  const { excluded, allowNames } = readExclude();
  const namesFrom = option(args, "--names-from");
  const names = namesFrom ? nameFinder(namesFrom, allowNames) : null;
  const problems = [];
  const tracked = trackedFiles();
  for (const file of new Set([...tracked, ...filesOnDisk()])) if (excluded(file)) problems.push(`${file}: excluded path is present`);
  for (const file of tracked) {
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const text = textOf(readFileSync(file));
    if (text === null) continue;
    for (const p of textProblems(text, names)) problems.push(`${file}: ${p}`);
  }
  let summary = `${tracked.length} tracked files`;
  if (args.includes("--history")) {
    const history = historyEntries();
    for (const file of history.paths) if (excluded(file)) problems.push(`${file}: excluded path is in history`);
    const contents = readBlobs([...history.blobs.keys()]);
    for (const [sha, files] of history.blobs) {
      const text = textOf(contents.get(sha));
      if (text === null) continue;
      for (const p of textProblems(text, names)) problems.push(`blob ${sha} (${[...files].join(", ")}) in history: ${p}`);
    }
    // Commit messages are published too.
    for (const entry of git(["log", "--all", "--format=%H%x00%B%x1e"]).toString("utf8").split("\x1e")) {
      const [sha, message] = entry.trim().split("\0");
      if (sha && message) for (const p of textProblems(message, names)) problems.push(`commit ${sha.slice(0, 12)} message: ${p}`);
    }
    summary += `, ${history.commits} commits and their messages, ${history.blobs.size} file versions in history`;
  }
  if (names) summary += `, ${names.count} Qloo entity names checked`;
  if (problems.length > 0) {
    console.error(`Qloo data could reach the public mirror (${problems.length} problems in ${summary}):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`Exclude the path or old version in ${EXCLUDE_FILE}, or replace the data with made-up values.`);
    process.exit(1);
  }
  console.log(`No Qloo data in ${summary}.`);
}

function scan(args) {
  const { excluded, blobs: stripped, allowNames } = readExclude();
  const namesFrom = option(args, "--names-from");
  const names = namesFrom ? nameFinder(namesFrom, allowNames) : null;
  // What the mirror publishes is one branch (main in the workflow), not every local branch.
  const ref = option(args, "--ref") ?? "HEAD";
  const headBlobs = new Set();
  for (const entry of git(["ls-tree", "-r", "-z", ref]).toString("utf8").split("\0")) {
    if (entry) headBlobs.add(entry.slice(0, entry.indexOf("\t")).split(" ")[2]);
  }
  const history = historyEntries([ref]);
  const kept = [...history.blobs].filter(([sha, files]) => !stripped.has(sha) && [...files].some((f) => !excluded(f)));
  const contents = readBlobs(kept.map(([sha]) => sha));
  const fix = [];
  const strip = [];
  for (const [sha, files] of kept) {
    const text = textOf(contents.get(sha));
    if (text === null) continue;
    const problems = textProblems(text, names);
    if (problems.length === 0) continue;
    const where = [...files].filter((f) => !excluded(f)).join(", ");
    if (headBlobs.has(sha)) fix.push(`${where}: ${problems.join("; ")}`);
    else strip.push(`blob:${sha} ${where}   # ${problems.join("; ")}`);
  }
  // Commit messages are published as they are; one holding Qloo data needs a history rewrite.
  for (const entry of git(["log", ref, "--format=%H%x00%B%x1e"]).toString("utf8").split("\x1e")) {
    const [sha, message] = entry.trim().split("\0");
    if (sha && message) for (const p of textProblems(message, names)) fix.push(`commit ${sha.slice(0, 12)} message: ${p}`);
  }
  console.log(`Scanned ${kept.length} kept file versions and the messages of ${history.commits} commits${names ? `, ${names.count} Qloo entity names` : ""}.`);
  if (fix.length) {
    console.log(`\nIn the current tree: replace the data with made-up values, move it under an excluded path, or (a common word) add allow-name: lines to ${EXCLUDE_FILE}:`);
    console.log(fix.map((l) => `  ${l}`).join("\n"));
  }
  if (strip.length) console.log(`\nOld versions the mirror would still publish (add these lines to ${EXCLUDE_FILE}, after review):\n${strip.join("\n")}`);
  if (!fix.length && !strip.length) console.log("Nothing the filter keeps looks like Qloo data.");
  // Either kind fails: the mirror workflow checks every commit it publishes, so both would stop it.
  if (fix.length || strip.length) process.exitCode = 1;
}

function filterArgs(args) {
  const dir = args[0];
  if (!dir) throw new Error("Usage: node scripts/public-mirror.mjs filter-args <dir>");
  const { rules, blobs } = readExclude();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "paths.txt"), `${rules.map((r) => r.line).join("\n")}\n`);
  writeFileSync(path.join(dir, "blobs.txt"), blobs.size ? `${[...blobs.keys()].join("\n")}\n` : "");
  console.log(`Wrote ${path.join(dir, "paths.txt")} (${rules.length} path rules) and ${path.join(dir, "blobs.txt")} (${blobs.size} old file versions).`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const commands = { check, scan, "filter-args": filterArgs };
  if (!commands[command]) {
    console.error("Usage: node scripts/public-mirror.mjs check [--history] [--names-from <dir>] | scan [--ref <ref>] [--names-from <dir>] | filter-args <dir>");
    process.exit(2);
  }
  try {
    commands[command](rest);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// A command when run directly; tests import the matchers without running one.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
