// GET /api/report/[id]: a finished report (examples from data/runs, live ones from the store), or
// where to follow a run still going.
import { connection } from "next/server";
import { getReport } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getReport((await params).id, routeDeps());
}
