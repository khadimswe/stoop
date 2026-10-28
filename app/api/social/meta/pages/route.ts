// GET /api/social/meta/pages: the connected Pages (names, ids, whether Instagram is linked). No tokens.
// 404 while posting is off, which tells the page to keep its one-tap share links.
import { connection } from "next/server";
import { connectedPages } from "@/lib/social/routes";
import { socialDeps } from "@/lib/social/server";

export async function GET(request: Request) {
  await connection();
  return connectedPages(request, socialDeps());
}
