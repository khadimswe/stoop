// GET /api/waitlist/export: the founder's CSV, behind `Authorization: Bearer <WAITLIST_EXPORT_TOKEN>`.
// Without the token configured the route answers 404. Details in lib/routes/waitlist.ts.
import { connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { createWaitlistExport } from "@/lib/routes/waitlist";
import { getStore } from "@/lib/store";

const handler = createWaitlistExport({
  store: () => getStore(),
  botCheck: getBotCheck,
  token: () => process.env.WAITLIST_EXPORT_TOKEN,
});

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handler(request);
}
