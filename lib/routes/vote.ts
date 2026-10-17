// POST /api/vote and GET /api/vote?example=<slug>: blind-test votes, real and never seeded.
import { exampleSlugSchema, voteRequestSchema } from "../api/requests";
import { voteResponseSchema } from "../api/responses";
import { apiError, BodyError, cookieHeader, json, readCookie, readJson } from "../http";
import { RATE_RULES } from "../rate-limit";
import type { ExampleSlug } from "../demo/examples";
import { castVote, cookieVoter, newVoterToken, readVotes, validVoterToken, VOTER_COOKIE, VOTER_COOKIE_MAX_AGE, VOTING_CLOSED } from "../votes";
import { failSafe, guard, type GuardDeps } from "./guard";

export const VOTE_MAX_BYTES = 512;

export interface VoteDeps extends GuardDeps {
  /** True only for the example the blind test is running (votingOpenFor in lib/votes.ts). */
  votingOpen: (example: ExampleSlug) => boolean;
}

export function createVotePost(deps: VoteDeps) {
  return (request: Request) =>
    failSafe("POST /api/vote", async () => {
      const guarded = await guard(request, deps, RATE_RULES.vote);
      if (!guarded.ok) return guarded.response;
      const { store, visitor } = guarded;

      let body: unknown;
      try {
        body = await readJson(request, VOTE_MAX_BYTES);
      } catch (error) {
        if (error instanceof BodyError) return apiError("invalid", error.message, error.status);
        throw error;
      }
      const parsed = voteRequestSchema.safeParse(body);
      if (!parsed.success) return apiError("invalid", "Send an example and a choice (culture or control).", 400);
      if (!deps.votingOpen(parsed.data.example)) return apiError("off", VOTING_CLOSED, 409);

      // A browser without a valid cookie gets one now, so its next vote is caught even from another network.
      const existing = validVoterToken(readCookie(request, VOTER_COOKIE));
      const token = existing ?? newVoterToken();
      const { votes } = await castVote(store, parsed.data, { visitor, cookie: await cookieVoter(store, token) });
      const headers = existing ? undefined : { "Set-Cookie": cookieHeader(request, VOTER_COOKIE, token, VOTER_COOKIE_MAX_AGE) };
      return json(voteResponseSchema.parse(votes), { headers });
    });
}

export function createVoteGet(deps: GuardDeps) {
  return (request: Request) =>
    failSafe("GET /api/vote", async () => {
      const example = exampleSlugSchema.safeParse(new URL(request.url).searchParams.get("example"));
      if (!example.success) return apiError("invalid", "Name a shipped example with ?example=<slug>.", 400);
      const guarded = await guard(request, deps, RATE_RULES.voteRead);
      if (!guarded.ok) return guarded.response;
      const { store, visitor } = guarded;
      const token = validVoterToken(readCookie(request, VOTER_COOKIE));
      const votes = await readVotes(store, example.data, { visitor, cookie: token ? await cookieVoter(store, token) : null });
      return json(voteResponseSchema.parse(votes));
    });
}
