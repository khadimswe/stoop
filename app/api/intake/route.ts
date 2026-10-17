// POST /api/intake: "What are you selling?" Reads the link (or the description), Claude's reading of
// who the site speaks to, and the proposed seeds, for /start to confirm.
import { intakeRequestSchema } from "@/lib/api/requests";
import { runIntake } from "@/lib/runtime/intake";
import { errorResponse, json, liveModel, requestContext } from "@/lib/runtime/server";
import { getQlooClient } from "@/lib/qloo/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const input = intakeRequestSchema.parse(await request.json());
    return json(await runIntake({ client: getQlooClient(), model: liveModel() }, input, await requestContext(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
