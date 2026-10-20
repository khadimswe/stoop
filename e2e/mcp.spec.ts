import { expect, test, type Page } from "@playwright/test";

const TOKEN = `stp_${"Ab3_".repeat(10)}xyz`;

function tokenRoute(page: Page, answer: { status: number; body?: unknown; abort?: boolean }) {
  const calls: unknown[] = [];
  void page.route("**/api/mcp/token", async (route) => {
    calls.push(route.request().postDataJSON());
    if (answer.abort) return route.abort("failed");
    return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body ?? {}) });
  });
  return calls;
}

test("the page pitches, holds a labeled slot for the capture and shows setup with a placeholder token", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/mcp");
  await expect(page.getByRole("heading", { level: 1, name: "Use Stoop inside your Claude" })).toBeVisible();
  await expect(page.getByText("Works inside your Claude, with your own video tools.")).toBeVisible();
  await expect(page.getByText("Screen capture coming")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);

  const setup = page.getByRole("region", { name: /Add Stoop to Claude/ });
  const origin = new URL(page.url()).origin;
  await expect(setup.getByText(`claude mcp add --transport http stoop ${origin}/api/mcp --header "Authorization: Bearer stp_your_token_here"`)).toBeVisible();
  await expect(setup.getByText(`${origin}/api/mcp/stp_your_token_here`)).toBeVisible();
  await expect(setup.getByText("Recommended")).toBeVisible();
  await expect(page.getByText(/capped at 40 tool calls and 3 culture briefs a day, work until Nov 17, 2026/)).toBeVisible();

  const session = page.getByRole("region", { name: /Ask Claude/ });
  await expect(session.getByText(/^Example session, shortened/)).toBeVisible();
  await expect(session.getByText("score_brief", { exact: true })).toBeVisible();
  await expect(session.getByText("culture_brief", { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("the token form asks for an email before it sends anything", async ({ page }) => {
  const calls = tokenRoute(page, { status: 200, body: { token: TOKEN, expiresAt: "2026-11-17T08:00:00.000Z", emailed: true } });
  await page.goto("/mcp");
  await page.getByRole("button", { name: "Get my token" }).click();
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(page.getByText("Enter your email address. We send the token there too.")).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toBeFocused();
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Get my token" }).click();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  expect(calls).toHaveLength(0);
});

test("a token is shown once, with a copy button, the email status and its expiry", async ({ page, context, browserName }) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const calls = tokenRoute(page, { status: 200, body: { token: TOKEN, expiresAt: "2026-11-17T08:00:00.000Z", emailed: true } });
  await page.goto("/mcp");
  await page.getByRole("textbox", { name: "Email" }).fill("founder@brand.example");
  await page.getByRole("button", { name: "Get my token" }).click();

  await expect(page.getByRole("heading", { name: "Your token" })).toBeFocused();
  await expect(page.getByTestId("mcp-token")).toHaveText(TOKEN);
  await expect(page.getByText("We won't show it again. Copy it now and keep it somewhere safe.")).toBeVisible();
  await expect(page.getByText("We also emailed it to you.")).toBeVisible();
  await expect(page.getByText("Works until Nov 17, 2026, 3 AM Eastern.")).toBeVisible();
  expect(calls).toEqual([{ email: "founder@brand.example", consent: false }]);

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  if (browserName === "chromium") expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(TOKEN);
  // The form is gone: the token is never asked for twice on the same page.
  await expect(page.getByRole("button", { name: "Get my token" })).toHaveCount(0);
});

test("when the email copy could not go out, the page says to copy it now", async ({ page }) => {
  tokenRoute(page, { status: 200, body: { token: TOKEN, expiresAt: "2026-11-17T08:00:00.000Z", emailed: false } });
  await page.goto("/mcp");
  await page.getByRole("textbox", { name: "Email" }).fill("founder@brand.example");
  await page.getByRole("checkbox", { name: /product updates/ }).check();
  await page.getByRole("button", { name: "Get my token" }).click();
  await expect(page.getByText("We couldn't email a copy this time, so copy it before you leave this page.")).toBeVisible();
});

for (const [name, answer, copy] of [
  // The route's own messages (lib/routes/mcp-token.ts) for the limits and for closed tokens.
  [
    "the per-network limit",
    { status: 429, body: { error: { code: "rate_limited", message: "That's 3 tokens from here today. Use one you already have, or try again tomorrow." } } },
    "That's 3 tokens from here today.",
  ],
  ["the daily cap", { status: 429, body: { error: { code: "daily_cap", message: "Today's MCP tokens are all handed out. Try again tomorrow (UTC)." } } }, "Today's MCP tokens are all handed out."],
  ["tokens closed after judging", { status: 410, body: { error: { code: "off", message: "MCP tokens closed when judging ended." } } }, "MCP tokens closed when judging ended."],
  ["a bad email the browser let through", { status: 400, body: { error: { code: "invalid", message: "email: Invalid email address" } } }, "Check the email address and try again."],
  ["a dropped connection", { status: 0, abort: true }, "Couldn't reach Stoop."],
] as const) {
  test(`${name} is said in plain words, and the form stays`, async ({ page }) => {
    tokenRoute(page, answer);
    await page.goto("/mcp");
    await page.getByRole("textbox", { name: "Email" }).fill("founder@brand.example");
    await page.getByRole("button", { name: "Get my token" }).click();
    // Next adds its own (empty) route announcer with role alert: look inside main.
    await expect(page.locator("main").getByRole("alert")).toContainText(copy);
    await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("founder@brand.example");
    await expect(page.getByTestId("mcp-token")).toHaveCount(0);
  });
}
