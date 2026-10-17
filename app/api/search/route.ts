// GET /api/search?intakeId=&q=&type=: Qloo autocomplete for a "you" seed on /start.
import { connection } from "next/server";
import { searchRequestSchema } from "@/lib/api/requests";
import { getQlooClient } from "@/lib/qloo/server";
import { searchSeeds } from "@/lib/runtime/search";
import { errorResponse, json, requestContext } from "@/lib/runtime/server";

export async function GET(request: Request) {
  await connection();
  try {
    const query = new URL(request.url).searchParams;
    const input = searchRequestSchema.parse({ intakeId: query.get("intakeId"), q: query.get("q"), type: query.get("type") });
    return json(await searchSeeds({ client: getQlooClient() }, input, await requestContext(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
