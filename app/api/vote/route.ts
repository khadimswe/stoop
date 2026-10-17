// POST /api/vote and GET /api/vote?example=<slug>: blind-test votes, real and never seeded. Details in
// lib/routes/vote.ts and lib/votes.ts. Votes open only once the blind test runs (founder-approved clips).
import { connection } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { approvalsSchema, heroMode, LEAD_EXAMPLE, manifestSchema } from "@/lib/demo/hero";
import { createVoteGet, createVotePost } from "@/lib/routes/vote";
import { getStore } from "@/lib/store";
import { votingOpenFor } from "@/lib/votes";
import approvals from "@/public/demo/approvals.json";
import manifest from "@/public/demo/manifest.json";

const votingOpen = votingOpenFor(heroMode(manifestSchema.parse(manifest), approvalsSchema.parse(approvals), LEAD_EXAMPLE));
const deps = { store: () => getStore(), botCheck: getBotCheck };
const post = createVotePost({ ...deps, votingOpen });
const get = createVoteGet(deps);

export async function POST(request: Request): Promise<Response> {
  return post(request);
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  return get(request);
}
