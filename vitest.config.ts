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
    // Several test files replay the recorded Qloo fixtures (about 45 MB of JSON, parsed once per
    // worker). On a heavily loaded machine (load average above 20) that has taken over 20 s.
    testTimeout: 60_000,
  },
});
