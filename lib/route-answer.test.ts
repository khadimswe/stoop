import { describe, expect, it } from "vitest";
import { readJson, respond } from "./route-answer";

const post = (body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://localhost/api/revise", { method: "POST", body, headers });

/** A body that streams in chunks and never says how long it is, so only the read itself can cap it. */
function streamed(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= chunks) return controller.close();
      sent += 1;
      controller.enqueue(new TextEncoder().encode("x".repeat(size)));
    },
  });
}

describe("readJson for the frames and revise routes", () => {
  it("reads a JSON body sent as application/json", async () => {
    expect(await readJson(post(JSON.stringify({ segmentId: "seg-a" })))).toEqual({ ok: true, body: { segmentId: "seg-a" } });
    expect(await readJson(post("{}", { "content-type": "application/json; charset=utf-8" }))).toEqual({ ok: true, body: {} });
  });

  it("refuses a body not sent as JSON with 415, as another site's plain form would send it", async () => {
    const read = await readJson(post("{}", { "content-type": "text/plain" }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.answer.status).toBe(415);
    expect(await respond(read.answer).json()).toMatchObject({ error: { code: "invalid" } });
    expect((await readJson(post("{}", {}))).ok).toBe(false);
  });

  it("refuses bad JSON with 400 and a body past the cap with 413, declared or not", async () => {
    const bad = await readJson(post("{nope"));
    expect(bad.ok ? null : bad.answer.status).toBe(400);
    const declared = await readJson(post("x".repeat(5_000)));
    expect(declared.ok ? null : declared.answer.status).toBe(413);
    // No content-length: the read stops once the stream passes the cap.
    const request = new Request("http://localhost/api/revise", { method: "POST", body: streamed(100, 1_000), headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
    const undeclared = await readJson(request, 4_096);
    expect(undeclared.ok ? null : undeclared.answer.status).toBe(413);
  });
});
