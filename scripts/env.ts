// Loads local env files for scripts the way Next does: `.env.local` wins over `.env`. Values already
// set in the shell win over both (process.loadEnvFile never overrides). Nothing here prints a value.
import { existsSync } from "node:fs";

export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}
