// GET /api/health: is the app live, is the store answering, what is left of today's caps, and the
// last month-remaining Qloo reported. No secrets.
import { connection } from "next/server";
import type { HealthResponse } from "@/lib/api/responses";
import { dailyCaps, isLive } from "@/lib/config";
import { getStore } from "@/lib/store";
import { keys } from "@/lib/store/keys";
import { lastMonthRemaining } from "@/lib/qloo/shared";
import { json } from "@/lib/runtime/server";

export async function GET() {
  await connection();
  const caps = dailyCaps();
  const live = isLive();
  try {
    const store = getStore();
    const reachable = await store.ping();
    const used = async (cap: Parameters<typeof keys.daily>[0]) => (reachable ? ((await store.get<number>(keys.daily(cap))) ?? 0) : 0);
    const body: HealthResponse = {
      ok: reachable,
      live,
      store: reachable ? store.kind : "unreachable",
      caps: {
        liveRuns: { used: await used("live-runs"), cap: caps.liveRuns },
        frames: { used: await used("frames"), cap: caps.frames },
        qloo: { used: await used("qloo"), cap: caps.qloo },
        renders: { used: await used("renders"), cap: caps.renders },
      },
      qlooMonthRemaining: reachable ? ((await lastMonthRemaining(store)) ?? null) : null,
    };
    return json(body, reachable ? 200 : 503);
  } catch {
    const zero = (cap: number) => ({ used: 0, cap });
    return json({ ok: false, live, store: "unreachable", caps: { liveRuns: zero(caps.liveRuns), frames: zero(caps.frames), qloo: zero(caps.qloo), renders: zero(caps.renders) }, qlooMonthRemaining: null } satisfies HealthResponse, 503);
  }
}
