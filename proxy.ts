// The judge link: runs only on page requests that carry ?judge= (the matcher's query condition), so every
// other request, pages included, never reaches it and stays static. API routes, Next's own files and
// anything with a file extension are left out. What it answers: lib/judge/proxy.ts.
// Node runtime (the default for proxy; a `runtime` export would throw).
import type { NextRequest } from "next/server";
import { judgeConfig, type JudgeConfig } from "./lib/judge/pass";
import { judgeProxy } from "./lib/judge/proxy";
import { getStore } from "./lib/store";

function configOrOff(): JudgeConfig | null {
  try {
    return judgeConfig();
  } catch (error) {
    // A malformed JUDGING_ENDS_AT turns the pass off instead of breaking the page.
    console.error(`Judge pass is off: ${error instanceof Error ? error.message : "bad config"}`);
    return null;
  }
}

export function proxy(request: NextRequest): Promise<Response> {
  return judgeProxy(request, { config: configOrOff(), store: getStore });
}

export const config = {
  matcher: [
    {
      source: "/((?!api(?:/|$)|_next/|.*\\.[^/]+$).*)",
      has: [{ type: "query", key: "judge" }],
    },
  ],
};
