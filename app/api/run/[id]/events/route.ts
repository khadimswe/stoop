// GET /api/run/[id]/events: the run's trace as server-sent events. Live runs follow the store from
// `Last-Event-ID`; examples replay their recorded trace. One zod event schema and one reducer read both.
import { connection } from "next/server";
import { getEvents } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  return getEvents(request, (await params).id, routeDeps());
}
