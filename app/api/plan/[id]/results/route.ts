// POST /api/plan/[id]/results: the manager logs how the event went (walk-ins, sales, what was posted);
// it lands as a results.logged event the next plan reads. Example plans are read-only.
import { postPlanResults } from "@/lib/plan/routes";
import { planRouteDeps } from "@/lib/plan/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return postPlanResults(request, (await params).id, planRouteDeps());
}
