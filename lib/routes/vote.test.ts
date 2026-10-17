import { describe, expect, it } from "vitest";
import { allowAll } from "../bot-check";
import { MemoryStore } from "../store/memory";
import { VOTER_COOKIE, votingOpenFor } from "../votes";
import { createVoteGet, createVotePost, type VoteDeps } from "./vote";

/** Voting open, as once the blind test runs (the route reads it from the approved hero clips). */
function setup(votingOpen: VoteDeps["votingOpen"] = () => true) {
  const store = new MemoryStore();
  const deps = { store: () => store, botCheck: () => allowAll };
  return { store, post: createVotePost({ ...deps, votingOpen }), get: createVoteGet(deps) };
}

type Votes = { example: string; culture: number; control: number; n: number; early: boolean; yours: string | null };

const vote = (post: (r: Request) => Promise<Response>, payload: unknown, options: { ip?: string; cookie?: string } = {}) =>
  post(
    new Request("https://stoop.example/api/vote", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": options.ip ?? "203.0.113.7", ...(options.cookie ? { cookie: options.cookie } : {}) },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
const read = (get: (r: Request) => Promise<Response>, example: string, options: { ip?: string; cookie?: string } = {}) =>
  get(new Request(`https://stoop.example/api/vote?example=${example}`, { headers: { "x-forwarded-for": options.ip ?? "203.0.113.7", ...(options.cookie ? { cookie: options.cookie } : {}) } }));
const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";

describe("votes", () => {
  it("stay closed until the blind test runs for that example: nothing is counted before anyone can see it", async () => {
    const closed = setup(votingOpenFor({ kind: "reality-check" }));
    const response = await vote(closed.post, { example: "food-hot-sauce", choice: "culture" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "off", message: "Voting opens with the blind test." } });
    expect(((await (await read(closed.get, "food-hot-sauce")).json()) as Votes).n).toBe(0);

    const blindTest = { kind: "blind-test", example: "food-hot-sauce" } as Parameters<typeof votingOpenFor>[0];
    const open = setup(votingOpenFor(blindTest));
    expect((await vote(open.post, { example: "food-hot-sauce", choice: "culture" })).status).toBe(200);
    expect((await vote(open.post, { example: "home-candles", choice: "culture" }, { ip: "198.51.100.2" })).status).toBe(409);
  });

  it("start at zero, never seeded: n is 0 and the result is early", async () => {
    const { get } = setup();
    const response = await read(get, "food-hot-sauce");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ example: "food-hot-sauce", culture: 0, control: 0, n: 0, early: true, yours: null });
  });

  it("counts one vote per visitor, sets a first-party cookie, and says which one is yours", async () => {
    const { post, get } = setup();
    const first = await vote(post, { example: "food-hot-sauce", choice: "culture" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ example: "food-hot-sauce", culture: 1, control: 0, n: 1, early: true, yours: "culture" });
    const setCookie = first.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(new RegExp(`^${VOTER_COOKIE}=[0-9a-f]{32}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure$`));

    // The same network again, even from a fresh browser: not counted, and the first vote stays theirs.
    const again = (await (await vote(post, { example: "food-hot-sauce", choice: "control" })).json()) as Votes;
    expect(again).toMatchObject({ culture: 1, control: 0, n: 1, yours: "culture" });
    expect(((await (await read(get, "food-hot-sauce")).json()) as Votes).yours).toBe("culture");
    // Votes are per example.
    expect(((await (await vote(post, { example: "home-candles", choice: "control" })).json()) as Votes)).toMatchObject({ example: "home-candles", control: 1, n: 1 });
  });

  it("counts once per cookie too: the same browser on another network does not vote twice", async () => {
    const { post, get } = setup();
    const first = await vote(post, { example: "pets-outfits", choice: "control" });
    const cookie = cookieOf(first);
    const moved = await vote(post, { example: "pets-outfits", choice: "culture" }, { ip: "198.51.100.2", cookie });
    expect(await moved.json()).toMatchObject({ culture: 0, control: 1, n: 1, yours: "control" });
    expect(moved.headers.get("set-cookie")).toBeNull(); // a valid cookie is kept, not replaced
    expect(((await (await read(get, "pets-outfits", { ip: "198.51.100.2", cookie })).json()) as Votes).yours).toBe("control");
    // A different visitor with no cookie still counts.
    expect(await (await vote(post, { example: "pets-outfits", choice: "culture" }, { ip: "192.0.2.10" })).json()).toMatchObject({ culture: 1, control: 1, n: 2 });
  });

  it("counts once when the same visitor votes twice at the same moment", async () => {
    const { post, get } = setup();
    await Promise.all([vote(post, { example: "food-hot-sauce", choice: "culture" }), vote(post, { example: "food-hot-sauce", choice: "control" })]);
    expect(((await (await read(get, "food-hot-sauce")).json()) as Votes).n).toBe(1);
  });

  it("stays early until 30 real votes", async () => {
    const { post } = setup();
    let last: Votes | null = null;
    for (let i = 1; i <= 30; i++) {
      last = (await (await vote(post, { example: "home-candles", choice: i % 3 ? "culture" : "control" }, { ip: `10.0.0.${i}` })).json()) as Votes;
      expect(last.early).toBe(i < 30);
    }
    expect(last).toMatchObject({ culture: 20, control: 10, n: 30, early: false });
  });

  it("rejects anything but a shipped example and a known choice, and ignores a forged cookie", async () => {
    const { post, get, store } = setup();
    for (const payload of ["nope", { example: "made-up", choice: "culture" }, { example: "food-hot-sauce", choice: "both" }, { example: "food-hot-sauce", choice: "culture", n: 500 }, {}]) {
      const response = await vote(post, payload);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("invalid");
    }
    expect((await read(get, "made-up")).status).toBe(400);
    expect((await get(new Request("https://stoop.example/api/vote"))).status).toBe(400);
    expect(((await (await read(get, "food-hot-sauce")).json()) as Votes).n).toBe(0);
    const forged = await vote(post, { example: "food-hot-sauce", choice: "culture" }, { cookie: `${VOTER_COOKIE}=not-a-token` });
    expect(forged.headers.get("set-cookie")).toMatch(new RegExp(`^${VOTER_COOKIE}=[0-9a-f]{32};`));
    expect(store.kind).toBe("memory");
  });

  it("limits each visitor to 30 vote posts an hour", async () => {
    const { post } = setup();
    for (let i = 0; i < 30; i++) expect((await vote(post, { example: "food-hot-sauce", choice: "culture" })).status).toBe(200);
    expect((await vote(post, { example: "food-hot-sauce", choice: "culture" })).status).toBe(429);
  });
});
