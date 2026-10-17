// POST /api/run/[id]/resume: the Resume button. The next attempt replays what the stopped one already
// measured and wrote (from the shared caches) and goes on live from there.
import { postResume } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return postResume(request, (await params).id, routeDeps());
}
