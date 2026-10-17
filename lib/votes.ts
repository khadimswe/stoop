// Blind-test votes: real and never seeded. Counts start at zero in the store and only a vote moves
// them. One vote per visitor per example, checked two ways: by the visitor (a salted hash of the IP)
// and by a random first-party cookie. A vote counts once if either has voted already, so clearing
// cookies or switching networks alone does not vote twice. Answers always carry n, and "early" while
// n is under EARLY_VOTES.
import { VOTE_CHOICES, type VoteRequest } from "./api/requests";
import { EARLY_VOTES, type VoteResponse } from "./api/responses";
import type { ExampleSlug } from "./demo/examples";
import type { HeroMode } from "./demo/hero";
import { sha256 } from "./hash";
import { keys } from "./store/keys";
import type { Store } from "./store/types";
import { saltedHash, type VisitorId } from "./store/visitor";

export type VoteChoice = (typeof VOTE_CHOICES)[number];

/**
 * Votes open only for the example the landing blind test is running (lib/demo/hero.ts): until the
 * founder approves its clips nobody can see the test, so any vote cast before then (a curl, a team
 * test) would sit in n forever.
 */
export function votingOpenFor(mode: HeroMode): (example: ExampleSlug) => boolean {
  return (example) => mode.kind === "blind-test" && mode.example === example;
}

export const VOTING_CLOSED = "Voting opens with the blind test.";

/** The first-party cookie that marks a browser as having voted. Its value is random, never derived from the visitor. */
export const VOTER_COOKIE = "stoop_voter";
export const VOTER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const VOTER_TOKEN = /^[0-9a-f]{32}$/;

export function newVoterToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A cookie value Stoop could have set, or null (anything else is ignored and replaced). */
export function validVoterToken(value: string | null): string | null {
  return value && VOTER_TOKEN.test(value) ? value : null;
}

/**
 * The cookie's voter, in the same id space as an IP visitor (keys.votes.visitor takes a VisitorId),
 * hashed with the store's salt like an IP so the token itself is never a key. "cookie:" keeps the two
 * kinds of id apart.
 */
export async function cookieVoter(store: Store, token: string): Promise<VisitorId> {
  const hash = await saltedHash(store, `cookie:${token}`);
  return `v_${sha256(hash).slice(0, 24)}` as VisitorId;
}

export interface Voter {
  visitor: VisitorId;
  /** The cookie's voter id, when the browser sent a valid cookie or one is being set now. */
  cookie: VisitorId | null;
}

const isChoice = (value: unknown): value is VoteChoice => typeof value === "string" && (VOTE_CHOICES as readonly string[]).includes(value);

async function priorVote(store: Store, example: ExampleSlug, voter: Voter): Promise<VoteChoice | null> {
  const byVisitor = await store.get<string>(keys.votes.visitor(example, voter.visitor));
  if (isChoice(byVisitor)) return byVisitor;
  if (!voter.cookie) return null;
  const byCookie = await store.get<string>(keys.votes.visitor(example, voter.cookie));
  return isChoice(byCookie) ? byCookie : null;
}

/** The counts for one example, with this voter's own vote if they cast one. */
export async function readVotes(store: Store, example: ExampleSlug, voter: Voter | null): Promise<VoteResponse> {
  const [culture, control] = await Promise.all(VOTE_CHOICES.map(async (choice) => (await store.get<number>(keys.votes.count(example, choice))) ?? 0));
  const n = culture + control;
  return { example, culture, control, n, early: n < EARLY_VOTES, yours: voter ? await priorVote(store, example, voter) : null };
}

/**
 * Casts a vote, or leaves the counts alone when this visitor or cookie voted already. Each id is
 * claimed with set-if-absent before the count moves, so two requests at once still count once.
 */
export async function castVote(store: Store, vote: VoteRequest, voter: Voter): Promise<{ counted: boolean; votes: VoteResponse }> {
  const answer = async (counted: boolean) => ({ counted, votes: await readVotes(store, vote.example, voter) });
  if (await priorVote(store, vote.example, voter)) return answer(false);

  if (voter.cookie && !(await store.set(keys.votes.visitor(vote.example, voter.cookie), vote.choice, { ifAbsent: true }))) return answer(false);
  if (!(await store.set(keys.votes.visitor(vote.example, voter.visitor), vote.choice, { ifAbsent: true }))) {
    // This network voted from another browser at the same moment: the cookie takes that vote, uncounted.
    const theirs = await store.get<string>(keys.votes.visitor(vote.example, voter.visitor));
    if (voter.cookie && isChoice(theirs)) await store.set(keys.votes.visitor(vote.example, voter.cookie), theirs);
    return answer(false);
  }
  await store.incr(keys.votes.count(vote.example, vote.choice));
  return answer(true);
}
