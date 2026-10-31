// GET /api/plan/[id]/ages: which adult age bands the people who love a community's places skew toward
// (one Qloo call), for the Community step's "Who loves these spots" card. The handler and its limits
// live in lib/plan/ages.ts. Anything short of an answer is a 204, never a 500. No maxDuration export:
// next.config.ts says why every API route keeps Vercel's default.
import { connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { isLive } from "@/lib/config";
import { getPlanAges } from "@/lib/plan/ages";
import { getQlooClient } from "@/lib/qloo/server";
import { getStore } from "@/lib/store";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getPlanAges(request, (await params).id, { live: isLive(), store: getStore, botCheck: getBotCheck, client: getQlooClient });
}
