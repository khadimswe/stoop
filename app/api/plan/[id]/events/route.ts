// GET /api/plan/[id]/events: the plan's events as server-sent events. Live plans follow the store from
// `Last-Event-ID`; examples replay their recording. One event schema and one reducer read both.
import { connection } from "next/server";
import { getPlanEvents } from "@/lib/plan/routes";
import { planRouteDeps } from "@/lib/plan/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getPlanEvents(request, (await params).id, planRouteDeps());
}
