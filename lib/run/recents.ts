// "Recent campaigns": the live runs started in this browser, kept in localStorage as a per-viewer
// convenience (never shared, never sent anywhere). Storage can be missing or throw (private windows,
// blocked site data), so every read and write is wrapped and a failure reads as an empty list.

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecentCampaign {
  runId: string;
  /** The product's name as the run read it. */
  name: string;
  startedAt: string;
  status: "running" | "ready";
}

export const RECENTS_KEY = "stoop:recent-campaigns";
export const MAX_RECENTS = 5;
const RUN_ID = /^run_[0-9a-f]{24}$/;

function valid(entry: unknown): entry is RecentCampaign {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.runId === "string" &&
    RUN_ID.test(e.runId) &&
    typeof e.name === "string" &&
    e.name.length > 0 &&
    e.name.length <= 200 &&
    typeof e.startedAt === "string" &&
    !Number.isNaN(Date.parse(e.startedAt)) &&
    (e.status === "running" || e.status === "ready")
  );
}

export function readRecents(storage: KeyValueStore | null): RecentCampaign[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function write(storage: KeyValueStore | null, list: RecentCampaign[]): RecentCampaign[] {
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Full or blocked storage: the list is a convenience, so the run goes on without it.
  }
  return list;
}

/** Newest first, one entry per run, at most MAX_RECENTS. */
export function addRecent(storage: KeyValueStore | null, entry: RecentCampaign): RecentCampaign[] {
  if (!valid(entry)) return readRecents(storage);
  return write(storage, [entry, ...readRecents(storage).filter((e) => e.runId !== entry.runId)].slice(0, MAX_RECENTS));
}

/** Marks a run ready once its trace finished in this browser. Unknown runs are left alone. */
export function markRecent(storage: KeyValueStore | null, runId: string, status: RecentCampaign["status"]): RecentCampaign[] {
  const list = readRecents(storage);
  if (!list.some((e) => e.runId === runId && e.status !== status)) return list;
  return write(
    storage,
    list.map((e) => (e.runId === runId ? { ...e, status } : e)),
  );
}

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The browser's storage, or null where reading it throws. */
export function browserStorage(kind: "localStorage" | "sessionStorage"): KeyValueStore | null {
  try {
    if (typeof window === "undefined") return null;
    const storage = window[kind];
    const probe = "stoop:probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
