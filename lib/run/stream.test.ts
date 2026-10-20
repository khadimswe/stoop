import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { StreamStatus } from "../api/responses";
import { reduce, type RunEvent } from "../events";
import type { KeyValueStore } from "./recents";
import { BACKOFF_MS, createRunStream, ERROR_LIMIT, ERROR_WINDOW_MS, emptySnapshot, parseRunEvent, parseStreamStatus, persistKey, PERSIST_MS, type EventSourceLike, type RunSnapshot } from "./stream";
import { describeRecorded, ifRecorded, itRecorded } from "../testing/recorded";

// The recorded lead run (data/runs/), replayed through the real reducer.
const recorded = ifRecorded(() => JSON.parse(readFileSync("data/runs/food-hot-sauce/run.events.json", "utf8")) as RunEvent[]);
const EXAMPLE = "example-food-hot-sauce";
const LIVE = `run_${"c3".repeat(12)}`;
/** The same recorded events as a live run's, for the live-only paths (stopped, resumed). */
const asLive = (events: readonly RunEvent[], attempt?: number): RunEvent[] =>
  events.map((e) => ({ ...(e.type === "run.started" ? { ...e, runId: LIVE, kind: "live" as const } : e), ...(attempt ? { attempt } : {}) }));

class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  private dispatch(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
  }
  open() {
    this.readyState = 1;
    this.dispatch("open");
  }
  run(...events: RunEvent[]) {
    for (const event of events) this.dispatch("run", JSON.stringify(event));
  }
  status(status: StreamStatus) {
    this.dispatch("status", JSON.stringify(status));
  }
  /** The browser lost the connection: it retries itself (connecting) or gives up (closed). */
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.dispatch("error");
  }
}

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function harness(runId: string, options: { storage?: KeyValueStore | null; fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const sources: FakeSource[] = [];
  const timers: { run: () => void; ms: number; id: number }[] = [];
  const fetches: { url: string; init?: RequestInit }[] = [];
  let clock = 1_000;
  let nextId = 0;
  const snapshots: RunSnapshot[] = [];
  const stream = createRunStream(
    runId,
    {
      createSource: (url) => {
        const source = new FakeSource(url);
        sources.push(source);
        return source;
      },
      fetch: (async (url: string, init?: RequestInit) => {
        fetches.push({ url, init });
        return options.fetch ? options.fetch(url, init) : json({ error: { code: "failed", message: "No fetch in this test." } }, 500);
      }) as typeof fetch,
      storage: options.storage === undefined ? memoryStorage() : options.storage,
      now: () => (clock += 100),
      setTimer: (run, ms) => {
        const id = ++nextId;
        timers.push({ run, ms, id });
        return id;
      },
      clearTimer: (id) => {
        const index = timers.findIndex((t) => t.id === id);
        if (index !== -1) timers.splice(index, 1);
      },
    },
    (snapshot) => snapshots.push(snapshot),
  );
  return {
    stream,
    sources,
    timers,
    fetches,
    snapshots,
    last: () => stream.snapshot(),
    source: () => sources.at(-1)!,
    /** Runs the next timer (a backoff or a persist), like time passing. */
    tick: () => timers.shift()?.run(),
    /** Moves the clock on. */
    skip: (ms: number) => void (clock += ms),
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

describeRecorded("following a run's events", () => {
  it("builds exactly the reducer's state from an example replay, then closes on the done status", () => {
    const h = harness(EXAMPLE);
    h.stream.start();
    expect(h.sources).toHaveLength(1);
    expect(h.source().url).toBe(`/api/run/${EXAMPLE}/events`);
    expect(h.last().connection).toBe("connecting");
    h.source().open();
    h.source().run(...recorded);
    h.source().status({ status: "done", attempt: 1, resumable: false });
    const last = h.last();
    expect(last.state).toEqual(reduce(recorded));
    expect(last.events).toHaveLength(recorded.length);
    expect(last).toMatchObject({ connection: "closed", stream: { status: "done" }, problem: null });
    expect(last.endedAt).not.toBeNull();
    expect(h.source().closed).toBe(true);
  });

  it("never applies an event twice, so a reconnect that resends events changes nothing", () => {
    const h = harness(EXAMPLE);
    h.stream.start();
    h.source().run(...recorded.slice(0, 60));
    const before = h.last();
    h.source().run(...recorded.slice(20, 60));
    expect(h.last().state).toBe(before.state);
    expect(h.last().events).toHaveLength(60);
  });

  it("ignores anything that is not a run event", () => {
    expect(parseRunEvent("{")).toBeNull();
    expect(parseRunEvent(JSON.stringify({ seq: 1, type: "made.up" }))).toBeNull();
    expect(parseRunEvent(JSON.stringify(recorded[0]))).toEqual(recorded[0]);
    expect(parseStreamStatus(JSON.stringify({ status: "stopped", attempt: 2, resumable: true }))).toEqual({ status: "stopped", attempt: 2, resumable: true });
    expect(parseStreamStatus(JSON.stringify({ status: "paused", attempt: 1, resumable: false }))).toBeNull();
    const h = harness(EXAMPLE);
    h.stream.start();
    h.source().run(recorded[0]);
    const state = h.last().state;
    (h.source() as unknown as { dispatch: (type: string, data: string) => void }).dispatch("run", "not json");
    expect(h.last().state).toBe(state);
  });

  it("resumes after a reload from the last event it kept, without duplicates", () => {
    const storage = memoryStorage();
    const first = harness(EXAMPLE, { storage });
    first.stream.start();
    first.source().run(...recorded.slice(0, 40));
    // Persisting is throttled; the page hiding flushes it.
    expect(first.timers.some((t) => t.ms === PERSIST_MS)).toBe(true);
    first.stream.flush();
    first.stream.stop();
    expect(storage.data.has(persistKey(EXAMPLE))).toBe(true);

    const second = harness(EXAMPLE, { storage });
    second.stream.start();
    const lastSeq = recorded[39].seq;
    expect(second.source().url).toBe(`/api/run/${EXAMPLE}/events?lastEventId=${encodeURIComponent(`1:${lastSeq}`)}`);
    expect(second.last().state).toEqual(reduce(recorded.slice(0, 40)));
    // The server resends from a little earlier; nothing applies twice.
    second.source().run(...recorded.slice(35));
    second.source().status({ status: "done", attempt: 1, resumable: false });
    expect(second.last().state).toEqual(reduce(recorded));
    expect(second.last().events).toHaveLength(recorded.length);
    expect(second.last().state.trace).toHaveLength(reduce(recorded).trace.length);
    // A finished example is cleared, so opening it again replays it from the start.
    expect(storage.data.has(persistKey(EXAMPLE))).toBe(false);
  });

  it("keeps a finished live run, so a reload shows it without reconnecting", () => {
    const storage = memoryStorage();
    const first = harness(LIVE, { storage });
    first.stream.start();
    first.source().run(...asLive(recorded));
    first.source().status({ status: "done", attempt: 1, resumable: false });
    const second = harness(LIVE, { storage });
    second.stream.start();
    expect(second.sources).toHaveLength(0);
    expect(second.last()).toMatchObject({ connection: "closed", state: { status: "done", runId: LIVE } });
  });

  it("never shows another run's saved events", () => {
    const storage = memoryStorage();
    storage.setItem(persistKey(LIVE), JSON.stringify({ v: 1, events: recorded.slice(0, 10), openedAt: 1, endedAt: null }));
    const h = harness(LIVE, { storage });
    h.stream.start();
    expect(h.last().state.runId).toBeNull();
    expect(h.source().url).toBe(`/api/run/${LIVE}/events`);
    expect(storage.data.has(persistKey(LIVE))).toBe(false);
  });

  it("works without storage at all", () => {
    const h = harness(EXAMPLE, { storage: null });
    h.stream.start();
    h.source().run(...recorded);
    expect(h.last().state.status).toBe("done");
  });
});

describe("reconnecting", () => {
  itRecorded("lets the browser retry a dropped connection by itself", () => {
    const h = harness(EXAMPLE);
    h.stream.start();
    h.source().run(...recorded.slice(0, 10));
    h.source().fail(false);
    expect(h.last().connection).toBe("reconnecting");
    expect(h.sources).toHaveLength(1);
    expect(h.fetches).toHaveLength(0);
  });

  itRecorded("says the connection was lost after the browser's own retries keep failing, and Try again starts over", () => {
    const h = harness(LIVE);
    h.stream.start();
    h.source().run(...asLive(recorded.slice(0, 10)));
    for (let i = 1; i < ERROR_LIMIT; i++) h.source().fail(false);
    expect(h.last()).toMatchObject({ connection: "reconnecting", problem: null });
    // An event or a reopened stream starts the count over.
    h.source().open();
    for (let i = 1; i < ERROR_LIMIT; i++) h.source().fail(false);
    expect(h.last().problem).toBeNull();
    h.source().fail(false);
    expect(h.last()).toMatchObject({ connection: "closed", problem: { kind: "lost", message: "Lost the connection to this run. It may still be running on our side." } });
    expect(h.source().closed).toBe(true);
    h.stream.retry();
    expect(h.sources).toHaveLength(2);
    expect(h.last()).toMatchObject({ problem: null, retries: 0 });
  });

  it("says the connection was lost when the browser has been failing for 30 s, even with few errors", () => {
    const h = harness(LIVE);
    h.stream.start();
    h.source().fail(false);
    h.skip(ERROR_WINDOW_MS);
    h.source().fail(false);
    expect(h.last().problem).toMatchObject({ kind: "lost" });
  });

  itRecorded("follows a running run again when the page comes back from the back-forward cache, and leaves an ended one alone", () => {
    const h = harness(LIVE);
    h.stream.start();
    h.source().run(...asLive(recorded.slice(0, 30)));
    h.stream.wake();
    expect(h.sources).toHaveLength(2);
    expect(h.sources[0].closed).toBe(true);
    expect(h.source().url).toContain(`lastEventId=${encodeURIComponent(`1:${recorded[29].seq}`)}`);
    h.source().run(...asLive(recorded.slice(30)));
    h.source().status({ status: "done", attempt: 1, resumable: false });
    h.stream.wake();
    expect(h.sources).toHaveLength(2);
    const stopped = harness(LIVE);
    stopped.stream.start();
    stopped.source().status({ status: "stopped", attempt: 1, resumable: true });
    stopped.stream.wake();
    expect(stopped.sources).toHaveLength(1);
  });

  itRecorded("backs off and reconnects from the last event while the server refuses, then says so plainly", async () => {
    const h = harness(EXAMPLE, { fetch: async () => json({ error: { code: "failed", message: "Live runs are not available here right now. The examples still work." } }, 503) });
    h.stream.start();
    h.source().run(...recorded.slice(0, 10));
    for (const [i, delay] of BACKOFF_MS.entries()) {
      h.source().fail(true);
      await h.settle();
      expect(h.last()).toMatchObject({ connection: "reconnecting", retries: i + 1 });
      const backoff = h.timers.find((t) => t.ms === delay)!;
      expect(backoff).toBeDefined();
      h.timers.splice(h.timers.indexOf(backoff), 1);
      backoff.run();
      expect(h.source().url).toContain(`lastEventId=${encodeURIComponent(`1:${recorded[9].seq}`)}`);
    }
    expect(h.fetches[0].init?.headers).toMatchObject({ "last-event-id": `1:${recorded[9].seq}` });
    h.source().fail(true);
    await h.settle();
    expect(h.last()).toMatchObject({ connection: "closed", problem: { kind: "unavailable", message: "Live runs are not available here right now. The examples still work." } });
    // "Try again" starts over at once.
    h.stream.retry();
    expect(h.last()).toMatchObject({ problem: null, retries: 0 });
    expect(h.sources).toHaveLength(BACKOFF_MS.length + 2);
  });

  it("says the connection was lost when the network keeps failing", async () => {
    const h = harness(LIVE, {
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    h.stream.start();
    for (let i = 0; i <= BACKOFF_MS.length; i++) {
      h.source().fail(true);
      await h.settle();
      h.timers.filter((t) => t.ms !== PERSIST_MS).forEach((t) => (h.timers.splice(h.timers.indexOf(t), 1), t.run()));
    }
    expect(h.last().problem).toMatchObject({ kind: "lost" });
  });

  itRecorded("treats 404 as an expired run and 204 as an ended stream", async () => {
    const expired = harness(LIVE, { fetch: async () => json({ error: { code: "not_found", message: "That run has expired." } }, 404) });
    expired.stream.start();
    expired.source().fail(true);
    await expired.settle();
    expect(expired.last()).toMatchObject({ connection: "closed", problem: { kind: "expired", message: "That run has expired." } });

    const ended = harness(EXAMPLE, { fetch: async () => new Response(null, { status: 204 }) });
    ended.stream.start();
    ended.source().run(...recorded);
    ended.source().fail(true);
    await ended.settle();
    expect(ended.last()).toMatchObject({ connection: "closed", problem: null, state: { status: "done" } });
    expect(ended.sources).toHaveLength(1);
  });

  itRecorded("keeps Resume after a reload of a stopped run, when the stream answers 204 with no status", async () => {
    // The server answers 204 to any run that is not running once the viewer holds its last event.
    const storage = memoryStorage();
    const first = harness(LIVE, { storage });
    first.stream.start();
    first.source().run(...asLive(recorded.slice(0, 50)));
    first.source().status({ status: "stopped", attempt: 1, resumable: true });
    first.stream.stop();

    const report = { status: "running", runId: LIVE, eventsUrl: `/api/run/${LIVE}/events`, resumable: true };
    const second = harness(LIVE, { storage, fetch: async (url) => (url.startsWith("/api/report/") ? json(report, 200) : new Response(null, { status: 204 })) });
    second.stream.start();
    second.source().fail(true);
    await second.settle();
    await second.settle();
    expect(second.fetches.map((f) => f.url)).toEqual([expect.stringContaining(`/api/run/${LIVE}/events?lastEventId=`), `/api/report/${LIVE}`]);
    expect(second.last()).toMatchObject({ connection: "closed", stream: { status: "stopped", resumable: true }, problem: null });

    // A run that finished without its run.done event in view reads as done; one that is gone, as expired.
    const done = harness(LIVE, { fetch: async (url) => (url.startsWith("/api/report/") ? json({ status: "done", report: { meta: { provenance: "live" } }, eventsUrl: null }, 200) : new Response(null, { status: 204 })) });
    done.stream.start();
    done.source().run(...asLive(recorded.slice(0, 50)));
    done.source().fail(true);
    await done.settle();
    await done.settle();
    expect(done.last().stream).toMatchObject({ status: "done" });
    const gone = harness(LIVE, { fetch: async (url) => (url.startsWith("/api/report/") ? json({ error: { code: "not_found", message: "That report has expired." } }, 404) : new Response(null, { status: 204 })) });
    gone.stream.start();
    gone.source().run(...asLive(recorded.slice(0, 50)));
    gone.source().fail(true);
    await gone.settle();
    await gone.settle();
    expect(gone.last().problem).toMatchObject({ kind: "expired", message: "That report has expired." });
  });

  itRecorded("reconnects when the stream answers fine again, and ignores an old connection's messages", async () => {
    const h = harness(EXAMPLE, { fetch: async () => new Response("retry: 3000\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }) });
    h.stream.start();
    const old = h.source();
    old.fail(true);
    await h.settle();
    h.tick();
    expect(h.sources).toHaveLength(2);
    old.run(recorded[0]);
    expect(h.last().state.runId).toBeNull();
    h.source().run(recorded[0]);
    expect(h.last().state.runId).toBe(EXAMPLE);
  });
});

describe("stopped runs", () => {
  itRecorded("closes on a stopped status, then Resume follows the next attempt from seq 0", async () => {
    const h = harness(LIVE, {
      fetch: async (url) => (url.endsWith("/resume") ? json({ mode: "live", runId: LIVE, eventsUrl: `/api/run/${LIVE}/events`, reportUrl: `/report/${LIVE}`, joined: false }, 200) : json({}, 500)),
    });
    h.stream.start();
    const firstHalf = asLive(recorded.slice(0, 50));
    h.source().run(...firstHalf);
    h.source().status({ status: "stopped", attempt: 1, resumable: true });
    expect(h.last()).toMatchObject({ connection: "closed", stream: { status: "stopped", resumable: true } });
    expect(h.source().closed).toBe(true);

    const [a, b] = [h.stream.resume(), h.stream.resume()];
    expect(b).toBe(a);
    await expect(a).resolves.toEqual({ kind: "live" });
    expect(h.fetches.filter((f) => f.url.endsWith("/resume"))).toHaveLength(1);
    expect(h.fetches[0].init?.method).toBe("POST");
    expect(h.sources).toHaveLength(2);
    expect(h.last().stream).toBeNull();

    const second = asLive(recorded, 2);
    h.source().run(...second);
    h.source().status({ status: "done", attempt: 2, resumable: false });
    expect(h.last().state).toEqual(reduce(second));
    expect(h.last().state.attempt).toBe(2);
    expect(h.last().events).toHaveLength(recorded.length);
  });

  it("hands back an example replay or a refusal from Resume, without reconnecting", async () => {
    const replay = harness(LIVE, { fetch: async () => json({ mode: "example", slug: "food-hot-sauce", reason: "replay", message: "Live runs are off right now." }, 200) });
    replay.stream.start();
    await expect(replay.stream.resume()).resolves.toEqual({ kind: "example", slug: "food-hot-sauce", reason: "replay" });
    const busy = harness(LIVE, { fetch: async () => json({ error: { code: "busy", message: "Two live runs are going right now. Try Resume again in a minute." } }, 503) });
    busy.stream.start();
    await expect(busy.stream.resume()).resolves.toEqual({ kind: "error", message: "Two live runs are going right now. Try Resume again in a minute." });
    expect(busy.sources).toHaveLength(1);
  });
});

describe("the empty snapshot", () => {
  it("starts connecting with nothing measured", () => {
    expect(emptySnapshot(LIVE)).toMatchObject({ runId: LIVE, connection: "connecting", state: { status: "idle", trace: [] }, problem: null });
  });
});
