// A fake Upstash REST endpoint for tests: the Redis commands UpstashStore sends, with TTLs on an
// injectable clock, as a `fetch`. The two Lua scripts are mirrored line by line in TypeScript (the
// real ones run in `npm run store:check`). Test-only.
import { LEASE_SCRIPT, SLOT_SCRIPT } from "./upstash";

type Value = { type: "string"; value: string } | { type: "list"; items: string[] } | { type: "zset"; scores: Map<string, number> };

export interface FakeUpstash {
  fetch: typeof fetch;
  /** Every command received, for tests that check what was sent. */
  commands: (string | number)[][];
}

export function fakeUpstash(options: { now: () => number; token?: string }): FakeUpstash {
  const data = new Map<string, { value: Value; expiresAt: number | null }>();
  const commands: (string | number)[][] = [];
  const now = options.now;

  const live = (key: string) => {
    const entry = data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) data.delete(key);
    return data.get(key) ?? null;
  };
  const wrongType = () => {
    throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
  };
  const ofType = <K extends Value["type"]>(key: string, type: K) => {
    const entry = live(key);
    if (entry && entry.value.type !== type) wrongType();
    return entry as { value: Extract<Value, { type: K }>; expiresAt: number | null } | null;
  };
  const slice = (items: string[], start: number, end: number) => {
    const from = start < 0 ? Math.max(items.length + start, 0) : start;
    const to = end < 0 ? items.length + end : Math.min(end, items.length - 1);
    return from > to ? [] : items.slice(from, to + 1);
  };

  function run(command: (string | number)[]): unknown {
    const [name, ...rest] = command;
    const args = rest.map(String);
    switch (String(name).toUpperCase()) {
      case "PING":
        return "PONG";
      case "GET": {
        const entry = ofType(args[0], "string");
        return entry ? entry.value.value : null;
      }
      case "SET": {
        const [key, value, ...flags] = args;
        let expiresAt: number | null = null;
        let nx = false;
        for (let i = 0; i < flags.length; i++) {
          const flag = flags[i].toUpperCase();
          if (flag === "EX") expiresAt = now() + Number(flags[++i]) * 1000;
          else if (flag === "PX") expiresAt = now() + Number(flags[++i]);
          else if (flag === "NX") nx = true;
          else throw new Error(`ERR unknown SET flag ${flag}`);
        }
        if (nx && live(key)) return null;
        data.set(key, { value: { type: "string", value }, expiresAt });
        return "OK";
      }
      case "DEL":
        return data.delete(args[0]) ? 1 : 0;
      case "EXPIRE":
      case "PEXPIRE": {
        const entry = live(args[0]);
        if (!entry) return 0;
        entry.expiresAt = now() + Number(args[1]) * (String(name).toUpperCase() === "EXPIRE" ? 1000 : 1);
        return 1;
      }
      case "INCRBY": {
        const entry = ofType(args[0], "string");
        const current = entry ? Number(entry.value.value) : 0;
        if (!Number.isInteger(current)) throw new Error("ERR value is not an integer");
        const value = current + Number(args[1]);
        data.set(args[0], { value: { type: "string", value: String(value) }, expiresAt: entry?.expiresAt ?? null });
        return value;
      }
      case "RPUSH": {
        const [key, ...items] = args;
        const entry = ofType(key, "list");
        const list = entry?.value.items ?? [];
        list.push(...items);
        data.set(key, { value: { type: "list", items: list }, expiresAt: entry?.expiresAt ?? null });
        return list.length;
      }
      case "LRANGE": {
        const entry = ofType(args[0], "list");
        return slice(entry?.value.items ?? [], Number(args[1]), Number(args[2]));
      }
      case "LLEN":
        return ofType(args[0], "list")?.value.items.length ?? 0;
      case "ZADD": {
        const [key, score, member] = args;
        const entry = ofType(key, "zset");
        const scores = entry?.value.scores ?? new Map<string, number>();
        const added = scores.has(member) ? 0 : 1;
        scores.set(member, Number(score));
        data.set(key, { value: { type: "zset", scores }, expiresAt: entry?.expiresAt ?? null });
        return added;
      }
      case "ZREM":
        return ofType(args[0], "zset")?.value.scores.delete(args[1]) ? 1 : 0;
      case "ZSCORE": {
        const score = ofType(args[0], "zset")?.value.scores.get(args[1]);
        return score === undefined ? null : String(score);
      }
      case "ZCARD":
        return ofType(args[0], "zset")?.value.scores.size ?? 0;
      case "ZCOUNT": {
        const scores = [...(ofType(args[0], "zset")?.value.scores.values() ?? [])];
        const min = args[1].startsWith("(") ? { value: Number(args[1].slice(1)), open: true } : { value: args[1] === "-inf" ? -Infinity : Number(args[1]), open: false };
        const max = args[2] === "+inf" ? Infinity : Number(args[2]);
        return scores.filter((s) => (min.open ? s > min.value : s >= min.value) && s <= max).length;
      }
      case "ZREMRANGEBYSCORE": {
        const entry = ofType(args[0], "zset");
        if (!entry) return 0;
        const max = Number(args[2]);
        let removed = 0;
        for (const [member, score] of entry.value.scores) if (score <= max) removed += entry.value.scores.delete(member) ? 1 : 0;
        return removed;
      }
      case "EVAL": {
        const [script, count, ...more] = args;
        const keys = more.slice(0, Number(count));
        const argv = more.slice(Number(count));
        if (script === LEASE_SCRIPT) {
          // Mirrors LEASE_SCRIPT line by line.
          const at = Number(argv[1]);
          const ttl = Number(argv[3]);
          run(["ZREMRANGEBYSCORE", keys[0], "-inf", at]);
          const held = run(["ZSCORE", keys[0], argv[0]]);
          if (held === null && Number(run(["ZCARD", keys[0]])) >= Number(argv[2])) return 0;
          run(["ZADD", keys[0], at + ttl, argv[0]]);
          run(["PEXPIRE", keys[0], ttl + 60000]);
          return 1;
        }
        if (script === SLOT_SCRIPT) {
          // Mirrors SLOT_SCRIPT line by line.
          const at = Number(argv[0]);
          const spacing = Number(argv[1]);
          const nextFree = Number(run(["GET", keys[0]]) ?? "0");
          const slot = Math.max(nextFree, at);
          run(["SET", keys[0], slot + spacing, "PX", slot + spacing - at + 60000]);
          return slot - at;
        }
        throw new Error("NOSCRIPT unknown script");
      }
      default:
        throw new Error(`ERR unknown command ${String(name)}`);
    }
  }

  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.token && new Headers(init?.headers).get("Authorization") !== `Bearer ${options.token}`) return answer({ error: "Unauthorized" }, 401);
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body)) as unknown;
    if (url.pathname.endsWith("/multi-exec")) {
      const batch = body as (string | number)[][];
      commands.push(...batch);
      return answer(
        batch.map((command) => {
          try {
            return { result: run(command) };
          } catch (error) {
            return { error: (error as Error).message };
          }
        }),
      );
    }
    const command = body as (string | number)[];
    commands.push(command);
    try {
      return answer({ result: run(command) });
    } catch (error) {
      return answer({ error: (error as Error).message }, 400);
    }
  }) as typeof fetch;

  return { fetch: fetchImpl, commands };
}
