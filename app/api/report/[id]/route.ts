// GET /api/report/[id]: a finished report (examples from data/runs, live ones from the store), or
// where to follow a run still going.
import { connection } from "next/server";
import { liveRunIdSchema } from "@/lib/api/requests";
import type { ReportResponse } from "@/lib/api/responses";
import { getStore } from "@/lib/store";
import { getRunMeta, loadReport, refreshReport } from "@/lib/store/runs";
import { ApiFailure } from "@/lib/runtime/errors";
import { exampleReport, exampleSlug } from "@/lib/runtime/examples";
import { errorResponse, json } from "@/lib/runtime/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    const slug = exampleSlug(id);
    if (slug) return json({ status: "done", report: await exampleReport(slug), eventsUrl: null } satisfies ReportResponse);
    const runId = liveRunIdSchema.parse(id);
    const store = getStore();
    const meta = await getRunMeta(store, runId);
    const eventsUrl = `/api/run/${runId}/events`;
    if (meta && (meta.status === "running" || meta.status === "stopped")) {
      return json({ status: "running", runId, eventsUrl, resumable: meta.status === "stopped" } satisfies ReportResponse);
    }
    const report = (await loadReport(store, runId)) ?? (meta ? await refreshReport(store, runId) : null);
    if (!report) throw new ApiFailure("not_found", "That report has expired.", 404);
    return json({ status: "done", report, eventsUrl: meta ? eventsUrl : null } satisfies ReportResponse);
  } catch (error) {
    return errorResponse(error);
  }
}
