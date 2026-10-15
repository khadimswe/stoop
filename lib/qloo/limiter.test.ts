import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

function fakeClock() {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => void (time += ms) };
}

describe("limiter", () => {
  it("spaces request starts at least 250 ms apart (4 per second)", async () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) {
      await limiter.pace();
      starts.push(clock.now());
    }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(250);
  });

  it("does not wait when the last start was long ago", async () => {
    const clock = fakeClock();
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep });
    await limiter.pace();
    await clock.sleep(5_000);
    const before = clock.now();
    await limiter.pace();
    expect(clock.now()).toBe(before);
  });

  it("caps tasks in flight", async () => {
    const limiter = createLimiter({ maxInFlight: 2 });
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };
    await Promise.all(["a", "b", "c", "d", "e"].map((key) => limiter.run(key, task)));
    expect(peak).toBe(2);
  });

  it("shares one promise for identical in-flight keys", async () => {
    const limiter = createLimiter();
    let calls = 0;
    const task = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return calls;
    };
    const [a, b] = await Promise.all([limiter.run("same", task), limiter.run("same", task)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("reports whether a key is in flight", async () => {
    const limiter = createLimiter();
    let release = () => {};
    const pending = limiter.run("k", () => new Promise<void>((resolve) => (release = resolve)));
    expect(limiter.inFlight("k")).toBe(true);
    expect(limiter.inFlight("other")).toBe(false);
    await Promise.resolve();
    release();
    await pending;
    expect(limiter.inFlight("k")).toBe(false);
  });

  it("runs the same key again once the first call has finished", async () => {
    const limiter = createLimiter();
    let calls = 0;
    await limiter.run("k", async () => ++calls);
    await limiter.run("k", async () => ++calls);
    expect(calls).toBe(2);
  });
});
