// The app's Qloo client. This is the only module that reads QLOO_API_KEY, and `server-only` makes
// any accidental import from a client component fail the build, so the key never reaches a browser.
import "server-only";
import path from "node:path";
import { FileCache, MemoryCache } from "./cache";
import { createQlooClient, type QlooClient } from "./client";

let client: QlooClient | undefined;

/** Lazily built so a missing key fails at the first live request, not at import or build time. */
export function getQlooClient(): QlooClient {
  client ??= createQlooClient({
    apiKey: process.env.QLOO_API_KEY,
    // Dev restarts and hot reloads would otherwise re-spend quota. Upstash replaces MemoryCache in Gate 5.
    cache:
      process.env.NODE_ENV === "development"
        ? new FileCache(path.join(process.cwd(), ".cache", "qloo"))
        : new MemoryCache(),
  });
  return client;
}
