// GET /api/social/meta/pages: the connected Pages (names, ids, whether Instagram is linked). No tokens.
// 404 while posting is off, which tells the page to keep its one-tap share links.
import { connection } from "next/server";
import { connectedPages } from "@/lib/social/routes";
import { failSafe } from "@/lib/routes/guard";
import { socialDeps } from "@/lib/social/server";

export async function GET(request: Request) {
  await connection();
  return failSafe("Meta pages", () => connectedPages(request, socialDeps()));
}
