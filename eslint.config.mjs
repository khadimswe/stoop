import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // API responses must never be logged. Warnings and errors are allowed.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, recorded, or local-only folders:
    "fixtures/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    ".cache/**",
    ".playwright-mcp/**",
    // Any other top-level dot folder (editor, tool and agent working copies).
    ".*/**",
    "stoop-setup/**",
  ]),
]);

export default eslintConfig;
