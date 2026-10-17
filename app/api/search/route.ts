// GET /api/search?intakeId=&q=&type=: Qloo autocomplete for a "you" seed on /start.
import { connection } from "next/server";
import { getSearch } from "@/lib/runtime/routes";
import { routeDeps } from "@/lib/runtime/server";

export async function GET(request: Request) {
  await connection();
  return getSearch(request, routeDeps());
}
