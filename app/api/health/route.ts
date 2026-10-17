// GET /api/health: is the app live, is the store answering, what is left of today's caps, and the
// last month-remaining Qloo reported. No secrets.
import { connection } from "next/server";
import { getHealth } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export async function GET() {
  await connection();
  return getHealth(routeDeps());
}
