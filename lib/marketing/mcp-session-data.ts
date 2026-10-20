// The /mcp example session's recorded answer (data/marketing/mcp-session.json, written by
// `npm run mcp:session`). It is Qloo response data, so the public repository leaves it out. Read
// with fs at build time (the page is static), never imported, so typecheck passes without it.
// Server and scripts only (it reads a file): the page hands the two strings to its client component.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { RecordedSession } from "./mcp-session";

export const MCP_SESSION_FILE = path.join("data", "marketing", "mcp-session.json");

const fileSchema = z.object({ scoreAnswer: z.string().min(1), claudeReply: z.string().min(1) });

/**
 * Reads data/marketing/mcp-session.json under the working directory. The path is written out in full
 * so the build's file tracer can follow it (a computed path makes it trace the whole project).
 */
export function loadRecordedSession(): RecordedSession {
  if (!existsSync(path.join(process.cwd(), "data", "marketing", "mcp-session.json"))) {
    throw new Error(
      `The /mcp example session is missing (${MCP_SESSION_FILE}). It is Qloo response data, so the public repository leaves it out. Write it from your own recordings with \`npm run mcp:session\` (README: "Data and the Qloo API").`,
    );
  }
  const { scoreAnswer, claudeReply } = fileSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "data", "marketing", "mcp-session.json"), "utf8")));
  return { scoreAnswer, claudeReply };
}
