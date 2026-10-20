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
const API_DATA = ["./data/geo/reference-heatmap.json", "./data/culture/panels.json", "./data/runs/**/*.json"];

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
    "/api/**": [...API_DATA, ...fixtures],
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
