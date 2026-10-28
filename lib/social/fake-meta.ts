// A fake Graph API for the social tests: it records every call (method, path, the parameters from the
// query, a form or a multipart body, and any uploaded file) and answers from a small table that the
// test can override per route ("POST 111/photos"). Every token it hands out is easy to search for, so
// tests can prove no token reaches a response.
import type { Fetch } from "./meta";

export interface FakeCall {
  method: string;
  /** The path after the version, e.g. "111/photos". */
  path: string;
  /** The query string's parameters for a GET. */
  query: Record<string, string>;
  /** A POST body's parameters (form or multipart). */
  body: Record<string, string>;
  file: { type: string; size: number; name: string } | null;
}

export type FakeAnswer = { status?: number; body: unknown } | ((call: FakeCall) => { status?: number; body: unknown });

export const FAKE_TOKENS = {
  short: "SHORTTOKEN_aaaaaaaaaaaaaaaa",
  user: "LONGUSERTOKEN_bbbbbbbbbbbbbbbb",
  page: "PAGETOKEN_cccccccccccccccc",
  otherPage: "PAGETOKEN_dddddddddddddddd",
} as const;

/** A made-up Meta app: the secret is a repeated letter, so no scanner mistakes it for a real one. */
export const FAKE_APP = { appId: "1234567890", appSecret: "x".repeat(32), configId: null } as const;

export const FAKE_PAGE ={ id: "111", name: "Corner Wireless on Fifth", instagram: { id: "17841400000000001", username: "cornerwireless" } } as const;

const DEFAULTS: Record<string, FakeAnswer> = {
  "GET oauth/access_token": (call) =>
    call.query.grant_type === "fb_exchange_token" ? { body: { access_token: FAKE_TOKENS.user, token_type: "bearer", expires_in: 5_184_000 } } : { body: { access_token: FAKE_TOKENS.short, token_type: "bearer", expires_in: 3_600 } },
  "GET me/accounts": {
    body: {
      data: [
        { id: FAKE_PAGE.id, name: FAKE_PAGE.name, access_token: FAKE_TOKENS.page, tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"], instagram_business_account: { id: FAKE_PAGE.instagram.id, username: FAKE_PAGE.instagram.username } },
        { id: "222", name: "A Page I only read", access_token: FAKE_TOKENS.otherPage, tasks: ["ANALYZE"] },
      ],
      paging: { cursors: { before: "x", after: "y" } },
    },
  },
  [`POST ${FAKE_PAGE.id}/photos`]: { body: { id: "900", post_id: `${FAKE_PAGE.id}_900` } },
  [`POST ${FAKE_PAGE.instagram.id}/media`]: { body: { id: "555" } },
  "GET 555": { body: { status_code: "FINISHED" } },
  [`POST ${FAKE_PAGE.instagram.id}/media_publish`]: { body: { id: "777" } },
  "GET 777": { body: { permalink: "https://www.instagram.com/p/abc123/" } },
};

/** A fake fetch for graph.facebook.com, with the calls it saw. */
export function fakeMeta(overrides: Record<string, FakeAnswer> = {}): { fetch: Fetch; calls: FakeCall[]; urls: string[] } {
  const calls: FakeCall[] = [];
  const urls: string[] = [];
  const table = { ...DEFAULTS, ...overrides };
  const fetchImpl: Fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url.toString());
    if (url.origin !== "https://graph.facebook.com") throw new TypeError(`unexpected host ${url.origin}`);
    const method = init?.method ?? "GET";
    const body: Record<string, string> = {};
    let file: FakeCall["file"] = null;
    if (init?.body instanceof URLSearchParams) Object.assign(body, Object.fromEntries(init.body));
    else if (init?.body instanceof FormData) {
      for (const [name, value] of init.body) {
        if (typeof value === "string") body[name] = value;
        else file = { type: value.type, size: value.size, name: value.name };
      }
    }
    const call: FakeCall = { method, path: url.pathname.replace(/^\/v\d+\.\d+\//, ""), query: Object.fromEntries(url.searchParams), body, file };
    calls.push(call);
    const answer = table[`${method} ${call.path}`];
    if (!answer) return Response.json({ error: { message: "Unknown path", type: "GraphMethodException", code: 100, error_subcode: 33 } }, { status: 400 });
    const { status, body: out } = typeof answer === "function" ? answer(call) : answer;
    return Response.json(out, { status: status ?? 200 });
  };
  return { fetch: fetchImpl, calls, urls };
}

/** A Graph error body, with a message that quotes a token, as real ones sometimes quote what was sent. */
export const graphError = (code: number, status = 400, subcode?: number) => ({
  status,
  body: { error: { message: `Error validating access token ${FAKE_TOKENS.page}`, type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: "Abc" } },
});
