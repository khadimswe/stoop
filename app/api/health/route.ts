// GET /api/health: is the app up and live. Today's caps, the store kind and the last month-remaining
// Qloo reported show only with the founder's ops token (lib/runtime/routes.ts getHealth). No secrets.
import { connection } from "next/server";
import { getHealth } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export async function GET(request: Request) {
  await connection();
  return getHealth(routeDeps(), request);
}
