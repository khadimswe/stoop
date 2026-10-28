// GET /api/plan/[id]: a plan's report so far (examples from data/plans, live plans from the store),
// with its status and where to follow it while it runs.
import { connection } from "next/server";
import { getPlan } from "@/lib/plan/routes";
import { planRouteDeps } from "@/lib/plan/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getPlan((await params).id, planRouteDeps());
}
