// POST /api/waitlist: "Get a free brief". The handler and its checks live in lib/routes/waitlist.ts.
import { after } from "next/server";
import { getBotCheck } from "@/lib/bot-check";
import { mailerFromEnv } from "@/lib/email";
import { createWaitlistPost } from "@/lib/routes/waitlist";
import { getStore } from "@/lib/store";

const handler = createWaitlistPost({
  store: () => getStore(),
  botCheck: getBotCheck,
  mailer: () => mailerFromEnv(),
  // The confirmation email goes out after the response, so a slow or failing send never holds up a signup.
  defer: (task) => after(task),
});

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
