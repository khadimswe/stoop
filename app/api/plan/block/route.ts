// POST /api/plan/block: a new store's community before any plan exists, for the Community step. The
// handler and its limits live in lib/plan/block.ts (tested against a MemoryStore and recorded Qloo).
import { getBotCheck } from "@/lib/bot-check";
import { isLive } from "@/lib/config";
import { postBlock } from "@/lib/plan/block";
import { getQlooClient } from "@/lib/qloo/server";
import { failSafe } from "@/lib/routes/guard";
import { getStore } from "@/lib/store";

export type { BlockAnswer } from "@/lib/plan/block";

export function POST(request: Request) {
  return failSafe("plan block", () => postBlock(request, { live: isLive(), store: getStore, botCheck: getBotCheck, client: getQlooClient }));
}
