// The app's Qloo client. This is the only module that reads QLOO_API_KEY, and `server-only` makes
// any accidental import from a client component fail the build, so the key never reaches a browser.
import "server-only";
import path from "node:path";
import { FileCache, MemoryCache } from "./cache";
import { createQlooClient, type QlooClient } from "./client";
import { FixtureCache } from "./fixtures";

export type QlooMode = "live" | "fixtures";

/** QLOO_MODE: "live" (default) or "fixtures" (replay recorded responses; no key, no calls). */
export function qlooMode(value = process.env.QLOO_MODE): QlooMode {
  const mode = value?.trim() || "live";
  if (mode !== "live" && mode !== "fixtures") throw new Error(`QLOO_MODE must be "live" or "fixtures", got "${mode}"`);
  return mode;
}

let client: QlooClient | undefined;

/** Lazily built so a missing key fails at the first live request, not at import or build time. */
export function getQlooClient(): QlooClient {
  if (client) return client;
  if (qlooMode() === "fixtures") {
    // Every request must have been recorded; a miss throws QlooFixtureMissError instead of going live.
    client = createQlooClient({ cache: FixtureCache.fromDir(path.join(process.cwd(), "fixtures"), { strict: true }) });
    return client;
  }
  client = createQlooClient({
    apiKey: process.env.QLOO_API_KEY,
    // Dev restarts and hot reloads would otherwise re-spend quota. Upstash replaces MemoryCache in Gate 5.
    cache:
      process.env.NODE_ENV === "development"
        ? new FileCache(path.join(process.cwd(), ".cache", "qloo"))
        : new MemoryCache(),
  });
  return client;
}
