import { describe, expect, it } from "vitest";
import { addRecent, markRecent, MAX_RECENTS, readRecents, RECENTS_KEY, timeAgo, type KeyValueStore, type RecentCampaign } from "./recents";

function memoryStorage(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const entry = (i: number, status: RecentCampaign["status"] = "running"): RecentCampaign => ({
  runId: `run_${String(i).padStart(24, "0")}`,
  name: `product ${i}`,
  startedAt: new Date(Date.UTC(2026, 9, 17, 12, i)).toISOString(),
  status,
});

describe("recent campaigns", () => {
  it("keeps the newest first, one per run, at most five", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 7; i++) addRecent(storage, entry(i));
    addRecent(storage, entry(5, "ready"));
    const list = readRecents(storage);
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0]).toEqual(entry(5, "ready"));
    expect(list.map((e) => e.runId)).toEqual([5, 6, 4, 3, 2].map((i) => entry(i).runId));
  });

  it("marks a run ready and leaves unknown runs alone", () => {
    const storage = memoryStorage();
    addRecent(storage, entry(1));
    expect(markRecent(storage, entry(1).runId, "ready")[0].status).toBe("ready");
    expect(markRecent(storage, entry(9).runId, "ready")).toEqual(readRecents(storage));
  });

  it("reads broken or foreign data, and blocked storage, as an empty list", () => {
    const storage = memoryStorage();
    storage.setItem(RECENTS_KEY, "{not json");
    expect(readRecents(storage)).toEqual([]);
    storage.setItem(RECENTS_KEY, JSON.stringify([{ runId: "javascript:alert(1)", name: "x", startedAt: "now", status: "ready" }, entry(2)]));
    expect(readRecents(storage)).toEqual([entry(2)]);
    expect(readRecents(throwing)).toEqual([]);
    expect(addRecent(throwing, entry(1))).toEqual([entry(1)]);
    expect(readRecents(null)).toEqual([]);
  });

  it("says how long ago a run started", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(timeAgo("2026-10-17T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-17T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-10-17T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-16T08:00:00Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-10-13T12:00:00Z", now)).toBe("4 days ago");
  });
});
