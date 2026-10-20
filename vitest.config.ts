import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    // Says once when the recorded Qloo data is absent (the public mirror) and its tests are skipped.
    globalSetup: ["./lib/testing/global-setup.ts"],
    // MCP tokens end at the earlier of their stored expiry and JUDGING_ENDS_AT as read at call time. Tests
    // that store a token on the real clock read a far end date, so they still pass once the real one is
    // behind us; tests of the end date itself pass their own.
    env: { JUDGING_ENDS_AT: "2099-01-01T00:00:00Z" },
    // Several test files replay the recorded Qloo fixtures (about 45 MB of JSON, parsed once per
    // worker). On a heavily loaded machine (load average above 20) that has taken over 20 s.
    testTimeout: 60_000,
  },
});
