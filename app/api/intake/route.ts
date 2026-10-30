// POST /api/intake: "What are you selling?" Reads the link (or the description), Claude's reading of
// who the site speaks to, and the proposed seeds, for /start to confirm.
import { postIntake } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export function POST(request: Request) {
  return postIntake(request, routeDeps());
}
