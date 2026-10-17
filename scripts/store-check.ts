// Checks the real Upstash database the way the tests check the fake one: JSON values, set-if-absent,
// TTLs (with real waits), counters, lists, admission leases and the pacer, the last two through their
// Lua scripts. Every key lives under one random prefix and is deleted at the end. Prints pass or
// fail per check, never a value from the env.
//
//   npm run store:check
import { getStore } from "../lib/store";
import { loadLocalEnv } from "./env";

loadLocalEnv();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const store = getStore();
  if (store.kind !== "upstash") {
    console.log("No Upstash keys are set (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN), so there is nothing to check.");
    process.exitCode = 1;
    return;
  }
  const prefix = `store-check:${Date.now().toString(36)}:`;
  const k = (name: string) => `${prefix}${name}`;
  const used: string[] = [];
  const key = (name: string) => (used.push(k(name)), k(name));
  const results: [string, boolean][] = [];
  const check = async (name: string, run: () => Promise<boolean>) => {
    try {
      results.push([name, await run()]);
    } catch (error) {
      results.push([`${name} (${error instanceof Error ? error.message : "error"})`, false]);
    }
  };

  await check("answers a ping", () => store.ping());
  await check("keeps a string that looks like a number as a string", async () => {
    await store.set(key("string"), "123");
    return (await store.get(k("string"))) === "123";
  });
  await check("writes only when absent with ifAbsent", async () => {
    const first = await store.set(key("nx"), { a: 1 }, { ifAbsent: true });
    const second = await store.set(k("nx"), { a: 2 }, { ifAbsent: true });
    return first && !second && (await store.get<{ a: number }>(k("nx")))?.a === 1;
  });
  await check("counts with a TTL fixed at first use", async () => {
    const one = await store.incr(key("counter"), { ttlSeconds: 2 });
    const three = await store.incr(k("counter"), { ttlSeconds: 60, by: 2 });
    await sleep(2_500);
    return one === 1 && three === 3 && (await store.get(k("counter"))) === null;
  });
  await check("appends and reads list ranges", async () => {
    await store.append(key("list"), [{ seq: 0 }, { seq: 1 }, "2"], { ttlSeconds: 60 });
    const all = await store.range(k("list"), 0, -1);
    return JSON.stringify(all) === JSON.stringify([{ seq: 0 }, { seq: 1 }, "2"]) && (await store.length(k("list"))) === 3 && (await store.append(k("list"), [])) === 3;
  });
  await check("admits at most max leases and refreshes a holder (Lua)", async () => {
    const lease = { max: 2, ttlMs: 60_000 };
    const a = await store.leaseAcquire(key("leases"), "a", lease);
    const b = await store.leaseAcquire(k("leases"), "b", lease);
    const c = await store.leaseAcquire(k("leases"), "c", lease);
    const again = await store.leaseAcquire(k("leases"), "a", lease);
    const count = await store.leaseCount(k("leases"));
    await store.leaseRelease(k("leases"), "a");
    const freed = await store.leaseAcquire(k("leases"), "c", lease);
    return a && b && !c && again && count === 2 && freed;
  });
  await check("drops expired leases (Lua)", async () => {
    await store.leaseAcquire(key("short"), "a", { max: 1, ttlMs: 500 });
    await sleep(800);
    return store.leaseAcquire(k("short"), "b", { max: 1, ttlMs: 500 });
  });
  await check("spaces pacer slots 250 ms apart (Lua)", async () => {
    const now = Date.now();
    const waits = await Promise.all([0, 1, 2, 3].map(() => store.reserveSlot(key("pacer"), 250, { now })));
    return JSON.stringify([...waits].sort((x, y) => x - y)) === JSON.stringify([0, 250, 500, 750]);
  });

  await Promise.all([...new Set(used)].map((name) => store.del(name)));
  for (const [name, ok] of results) console.log(`${ok ? "pass" : "FAIL"}  ${name}`);
  if (results.some(([, ok]) => !ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`store check stopped: ${error instanceof Error ? error.message : "error"}`);
  process.exitCode = 1;
});
