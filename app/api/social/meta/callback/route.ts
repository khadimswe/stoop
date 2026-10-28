// GET /api/social/meta/callback: Facebook sends the manager back here. The state is checked, the code
// is swapped for tokens, and the tokens are stored sealed on the server under a signed session cookie.
// The browser goes back to the page it came from with ?meta=connected (or denied, expired, failed).
import { connection } from "next/server";
import { connectCallback } from "@/lib/social/routes";
import { failSafe } from "@/lib/routes/guard";
import { socialDeps } from "@/lib/social/server";

export async function GET(request: Request) {
  await connection();
  return failSafe("Meta connect callback", () => connectCallback(request, socialDeps()));
}
