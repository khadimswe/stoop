// Fails if any tracked or new (non-ignored) text file contains an em dash (U+2014), or names one of the
// local-only working docs (the agent guide, the master plan, the spec or the design notes): those files
// are never committed, so code and docs state the rule itself instead of pointing at them.
// Mirrors the CI job so the check runs locally as part of `npm run check`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EM_DASH = String.fromCharCode(0x2014);
// Recorded Qloo responses and media are third-party data; hand-written files under fixtures/ are still checked.
const SKIP = [/^package-lock\.json$/, /^pnpm-lock\.yaml$/, /^yarn\.lock$/, /^public\/demo\//, /^public\/maplibre\//, /^fixtures\/raw\//, /^fixtures\/[^/]+\.json$/];
// The CI workflow lists the local-only filenames on purpose, to block them from commits.
const NAMES_ALLOWED_IN = new Set([".github/workflows/checks.yml"]);
// Built from parts, so this file never matches itself.
const LOCAL_DOCS = [
  ["CLAUDE", "\\.md"],
  ["docs/", "plan"],
  ["docs/", "spec"],
  ["docs", " plan"],
  ["plan", "\\.md"],
  ["spec", "\\.md"],
  ["design", "-notes"],
  ["plan", " section"],
].map(([a, b]) => new RegExp(`${a}${b}`, "i"));

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\0")
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

const dashes = [];
const docs = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  if (text.includes("\0")) continue; // binary
  const checkNames = !NAMES_ALLOWED_IN.has(file);
  text.split("\n").forEach((line, i) => {
    const where = `${file}:${i + 1}: ${line.trim().slice(0, 120)}`;
    if (line.includes(EM_DASH)) dashes.push(where);
    if (checkNames && LOCAL_DOCS.some((re) => re.test(line))) docs.push(where);
  });
}

if (dashes.length > 0) {
  console.error("Em dashes found. Replace each with a comma, period, colon, parentheses, or a hyphen:");
  for (const hit of dashes) console.error(`  ${hit}`);
}
if (docs.length > 0) {
  console.error("Local-only docs named in committed files. State the rule itself instead:");
  for (const hit of docs) console.error(`  ${hit}`);
}
if (dashes.length > 0 || docs.length > 0) process.exit(1);
console.log(`No em dashes or local-only doc names in ${files.length} files.`);
