// POST /api/mcp/token { email, consent, company? }: a free MCP token from the /mcp page, shown once and
// emailed once. The handler, its limits and the honeypot live in lib/routes/mcp-token.ts. This static
// segment wins over /api/mcp/[token], so it is never read as a path token.
import { getBotCheck } from "@/lib/bot-check";
import { mailerFromEnv } from "@/lib/email";
import { createMcpTokenPost } from "@/lib/routes/mcp-token";
import { getStore } from "@/lib/store";

const handler = createMcpTokenPost({ store: () => getStore(), botCheck: getBotCheck, mailer: () => mailerFromEnv() });

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
