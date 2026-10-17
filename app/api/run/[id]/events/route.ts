// GET /api/run/[id]/events: the run's trace as server-sent events. Live runs follow the store from
// `Last-Event-ID`; examples replay their recorded trace. One zod event schema and one reducer read both.
import { connection } from "next/server";
import { liveRunIdSchema } from "@/lib/api/requests";
import { getStore } from "@/lib/store";
import { getRunMeta } from "@/lib/store/runs";
import { exampleEvents, exampleSlug } from "@/lib/runtime/examples";
import { errorResponse } from "@/lib/runtime/server";
import { ApiFailure } from "@/lib/runtime/errors";
import { SSE_HEADERS, streamExample, streamLiveRun } from "@/lib/runtime/stream";

export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    const lastEventId = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("lastEventId");
    const slug = exampleSlug(id);
    if (slug) return new Response(streamExample(await exampleEvents(slug), { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
    const runId = liveRunIdSchema.parse(id);
    const store = getStore();
    if (!(await getRunMeta(store, runId))) throw new ApiFailure("not_found", "That run has expired.", 404);
    return new Response(streamLiveRun(store, runId, { lastEventId, signal: request.signal }), { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
