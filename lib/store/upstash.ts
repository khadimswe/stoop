// The production Store: Upstash Redis over its REST API (one POST per command, /multi-exec for an
// atomic transaction). Plain fetch, no SDK: values are JSON this adapter encodes and decodes itself,
// so a stored "123" stays a string. Errors never carry the URL or the token.
//
// The steps that need a condition (admission leases, the pacer's next slot, compare and delete) are Lua scripts, so
// they stay atomic across every instance. `npm run store:check` runs them against the real database.
import type { IncrOptions, LeaseOptions, SetOptions, Store } from "./types";

export interface UpstashConfig {
  url: string;
  token: string;
  fetch?: typeof fetch;
  /** Per command. */
  timeoutMs?: number;
}

export class UpstashError extends Error {
  override name = "UpstashError";
}

type Command = readonly (string | number)[];

/** Takes a lease when the set has room (or the member already holds one); expired leases go first. */
export const LEASE_SCRIPT = `
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local held = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not held and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], now + ttl, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ttl + 60000)
return 1
`.trim();

/** Deletes a key only while it still holds this exact value. */
export const DELETE_IF_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`.trim();

/** Reserves the next start slot `spacing` ms after the last one; returns the wait in ms. */
export const SLOT_SCRIPT = `
local now = tonumber(ARGV[1])
local spacing = tonumber(ARGV[2])
local nextFree = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(nextFree, now)
redis.call('SET', KEYS[1], slot + spacing, 'PX', slot + spacing - now + 60000)
return slot - now
`.trim();

const decode = <T>(raw: unknown): T => JSON.parse(String(raw)) as T;

const encode = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("The store keeps JSON values only.");
  return json;
};

export class UpstashStore implements Store {
  readonly kind = "upstash" as const;
  private readonly url: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: UpstashConfig) {
    this.url = config.url.replace(/\/+$/, "");
    this.token = config.token;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 5_000;
  }

  private async post(path: string, body: unknown, what: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new UpstashError(`Upstash ${what} did not answer (${error instanceof Error ? error.name : "error"}).`);
    }
    const parsed = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const message = parsed && typeof parsed === "object" && "error" in parsed ? `: ${String((parsed as { error: unknown }).error).slice(0, 200)}` : "";
      throw new UpstashError(`Upstash ${what} failed with ${response.status}${message}`);
    }
    return parsed;
  }

  private async call<T>(command: Command): Promise<T> {
    const answer = (await this.post("", command, String(command[0]))) as { result?: T; error?: string } | null;
    if (!answer || answer.error !== undefined) throw new UpstashError(`Upstash ${command[0]} failed: ${String(answer?.error ?? "no answer").slice(0, 200)}`);
    return answer.result as T;
  }

  /** MULTI/EXEC: every command runs, in order, with nothing in between. */
  private async transaction(commands: readonly Command[]): Promise<unknown[]> {
    const answers = (await this.post("/multi-exec", commands, `transaction (${commands.map((c) => c[0]).join(", ")})`)) as { result?: unknown; error?: string }[] | null;
    if (!Array.isArray(answers) || answers.length !== commands.length) throw new UpstashError("Upstash transaction gave an unexpected answer.");
    const failed = answers.find((a) => a.error !== undefined);
    if (failed) throw new UpstashError(`Upstash transaction failed: ${String(failed.error).slice(0, 200)}`);
    return answers.map((a) => a.result);
  }

  private evalScript<T>(script: string, keys: readonly string[], args: readonly (string | number)[]): Promise<T> {
    return this.call<T>(["EVAL", script, keys.length, ...keys, ...args]);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.call<string | null>(["GET", key]);
    return raw === null ? null : decode<T>(raw);
  }

  async set(key: string, value: unknown, options: SetOptions = {}): Promise<boolean> {
    const command: (string | number)[] = ["SET", key, encode(value)];
    if (options.ttlSeconds) command.push("EX", options.ttlSeconds);
    if (options.ifAbsent) command.push("NX");
    return (await this.call<string | null>(command)) === "OK";
  }

  async del(key: string): Promise<void> {
    await this.call(["DEL", key]);
  }

  async deleteIfEquals(key: string, value: unknown): Promise<boolean> {
    return Number(await this.evalScript(DELETE_IF_SCRIPT, [key], [encode(value)])) === 1;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.call(["EXPIRE", key, ttlSeconds]);
  }

  async incr(key: string, options: IncrOptions = {}): Promise<number> {
    const by = options.by ?? 1;
    if (!Number.isInteger(by)) throw new Error("incr takes whole numbers only.");
    if (!options.ttlSeconds) return Number(await this.call(["INCRBY", key, by]));
    // SET NX creates the counter with its TTL only when it is new; INCRBY then counts. Atomic together.
    const [, value] = await this.transaction([
      ["SET", key, 0, "EX", options.ttlSeconds, "NX"],
      ["INCRBY", key, by],
    ]);
    return Number(value);
  }

  async append(key: string, values: readonly unknown[], options: { ttlSeconds?: number } = {}): Promise<number> {
    if (values.length === 0) return this.length(key);
    const push: Command = ["RPUSH", key, ...values.map(encode)];
    if (!options.ttlSeconds) return Number(await this.call(push));
    const [length] = await this.transaction([push, ["EXPIRE", key, options.ttlSeconds]]);
    return Number(length);
  }

  async range<T>(key: string, start: number, end: number): Promise<T[]> {
    const items = await this.call<string[]>(["LRANGE", key, start, end]);
    return items.map((item) => decode<T>(item));
  }

  async length(key: string): Promise<number> {
    return Number(await this.call(["LLEN", key]));
  }

  async leaseAcquire(key: string, member: string, options: LeaseOptions): Promise<boolean> {
    const now = options.now ?? Date.now();
    return Number(await this.evalScript(LEASE_SCRIPT, [key], [member, now, options.max, options.ttlMs])) === 1;
  }

  async leaseRelease(key: string, member: string): Promise<void> {
    await this.call(["ZREM", key, member]);
  }

  async leaseCount(key: string, now: number = Date.now()): Promise<number> {
    return Number(await this.call(["ZCOUNT", key, `(${now}`, "+inf"]));
  }

  async leaseHeld(key: string, member: string, now: number = Date.now()): Promise<boolean> {
    const score = await this.call<string | null>(["ZSCORE", key, member]);
    return score !== null && Number(score) > now;
  }

  async reserveSlot(key: string, spacingMs: number, options: { now?: number } = {}): Promise<number> {
    return Number(await this.evalScript(SLOT_SCRIPT, [key], [options.now ?? Date.now(), spacingMs]));
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.call<string>(["PING"])) === "PONG";
    } catch {
      return false;
    }
  }
}
