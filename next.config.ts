import type { NextConfig } from "next";

// Data the API functions read from disk at request time: the reference audiences (city ranking) and
// the stored example runs (replays and reports). Recorded Qloo fixtures only ship when the build replays
// them (QLOO_MODE=fixtures); at about 240 MB they are past a serverless function's size limit, so that
// mode is for local builds.
const API_DATA = ["./data/geo/reference-heatmap.json", "./data/runs/**/*.json"];
const fixtureMode = process.env.QLOO_MODE?.trim() === "fixtures";
const fixtures = fixtureMode ? ["./fixtures/**/*.json"] : [];
// Code is bundled, so its sources never ship; the file readers above make the tracer reach for the
// whole project, so everything the functions do not read at run time is left out by name.
// Every top-level file (configs, docs, local notes) and every folder no function reads are left out.
const NOT_READ = [
  ...["./*.md", "./*.zip", "./LICENSE", "./components.json", "./package-lock.json", "./tsconfig*", "./*.config.*"],
  ...["lib", "components", "app", "hooks", "public", "scripts", "docs", "e2e", ".cache", "exports", "stoop-setup", "data/baselines", "data/data-check"].map((dir) => `./${dir}/**`),
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
