import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";
import { BUILD_DATA_FILES, missingDataMessage, missingFiles } from "./lib/recorded-data";
import { securityHeaderRules } from "./lib/security/csp";

// `next build` stops at once when the recorded Qloo data is missing (the public mirror leaves it out),
// with one message instead of a failed prerender. Only the build: `next typegen` (npm run typecheck),
// dev and start load this file too, and typecheck must pass without the data.
if (process.argv.slice(2).find((arg) => !arg.startsWith("-")) === "build") {
  const missing = missingFiles(BUILD_DATA_FILES);
  if (missing.length > 0) {
    console.error(missingDataMessage("next build", missing));
    process.exit(1);
  }
}

// Data the API functions read from disk at request time: the reference audiences (city ranking), the
// frozen reference panels (scoring) and the stored example runs (replays and reports). Recorded Qloo
// fixtures only ship when the build replays them (QLOO_MODE=fixtures); at about 240 MB they are past a
// serverless function's size limit, so that mode is for local builds.
const API_DATA = ["./data/geo/reference-heatmap.json", "./data/culture/panels.json", "./data/runs/**/*.json", "./data/plans/**/*.json"];

// Next's own server setup, which every function loads at boot (its error inspection requires
// server/lib/source-maps, compiled/stacktrace-parser and more). Vercel groups API routes by their
// maxDuration, and a group with no page in it got a trace without these files, so it crashed on boot
// ("Cannot find module './lib/source-maps'") before any handler ran. Every API function carries every
// file that setup reaches through require(), found here so a Next upgrade keeps the list right, plus
// the folders those files live in.
function nextSetupFiles(): string[] {
  const root = process.cwd();
  const resolveFrom = createRequire(path.join(root, "package.json"));
  // Packages resolve through their package.json (main or exports), so each one ships too.
  const manifests = new Set<string>();
  // Every package.json from the file up to its package's root (bundled packages nest their own).
  const manifestsOf = (file: string) => {
    const found: string[] = [];
    for (let dir = path.dirname(file); dir.startsWith(root) && dir !== root; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, "package.json"))) found.push(path.join(dir, "package.json"));
      if (/^(node_modules|@[^/]+)$/.test(path.basename(path.dirname(dir)))) break;
    }
    return found;
  };
  // A package outside Next ships whole: its exports can pick a different file on Vercel's Node than here
  // (@swc/helpers resolves to esm/ locally and to cjs/ there).
  const packages = new Set<string>();
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || !statSync(file).isFile()) return;
    seen.add(file);
    for (const manifest of manifestsOf(file)) manifests.add(manifest);
    for (const [, , spec] of readFileSync(file, "utf8").matchAll(/require\((["'])([^"']+)\1\)/g)) {
      if (isBuiltin(spec!)) continue;
      let resolved: string;
      try {
        resolved = resolveFrom.resolve(spec!, { paths: [path.dirname(file)] });
      } catch {
        continue; // an optional require behind a guard; it never loaded at setup either
      }
      if (!path.isAbsolute(resolved) || !resolved.startsWith(path.join(root, "node_modules"))) continue;
      if (!spec!.startsWith(".") && !spec!.startsWith("next/")) {
        const top = manifestsOf(resolved).at(-1);
        if (top) packages.add(path.dirname(top));
      }
      walk(resolved);
    }
  };
  walk(path.join(root, "node_modules/next/dist/server/node-environment.js"));
  return [...[...seen, ...manifests].map((file) => `./${path.relative(root, file)}`), ...[...packages].map((dir) => `./${path.relative(root, dir)}/**`)];
}
const NEXT_SETUP = [...nextSetupFiles(), ...["server/lib", "shared/lib", "lib", "client/components", "client/lib"].map((dir) => `./node_modules/next/dist/${dir}/**/*.js`)];

const fixtureMode = process.env.QLOO_MODE?.trim() === "fixtures";
const fixtures = fixtureMode ? ["./fixtures/**/*.json"] : [];
// Code is bundled, so its sources never ship; the file readers above make the tracer reach for the
// whole project, so everything the functions do not read at run time is left out by name.
// Every top-level file (configs, docs, local notes) and every folder no function reads are left out.
const NOT_READ = [
  ...["./*.md", "./*.zip", "./LICENSE", "./components.json", "./package-lock.json", "./tsconfig*", "./*.config.*", "./public-mirror.exclude"],
  ...["lib", "components", "app", "hooks", "public", "scripts", "docs", "e2e", ".cache", "exports", "stoop-setup", "data/baselines", "data/data-check", "data/marketing"].map((dir) => `./${dir}/**`),
  ...(fixtureMode ? [] : ["./fixtures/**"]),
];

const nextConfig: NextConfig = {
  // Do not generate an agent instructions file on `next dev`.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/**": [...API_DATA, ...fixtures, ...NEXT_SETUP],
    // The poster route draws an example over the background the founder approved, read from its
    // marketing folder (lib/plan/poster-approval.ts); public/ is not in the function bundle.
    "/api/plan/**": ["./data/plans/*/marketing/poster-bg-*.png"],
  },
  outputFileTracingExcludes: {
    "/api/**": NOT_READ,
  },
  // The site-wide security headers, and the stricter /byok set, on sources that never overlap
  // (lib/security/csp.ts), so two Content-Security-Policy headers never stack on one response.
  async headers() {
    return securityHeaderRules(process.env);
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
