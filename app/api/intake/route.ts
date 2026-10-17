// POST /api/intake: "What are you selling?" Reads the link (or the description), Claude's reading of
// who the site speaks to, and the proposed seeds, for /start to confirm.
import { postIntake } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

// Two readings, then the seeds, each with its own Claude timeout.
export const maxDuration = 120;

export function POST(request: Request) {
  return postIntake(request, routeDeps());
}
