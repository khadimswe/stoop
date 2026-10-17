import { expect, test } from "@playwright/test";

const BYOK = "/byok?reportId=example-food-hot-sauce&segment=control";
const policies = (headers: { name: string; value: string }[]) => headers.filter((h) => h.name.toLowerCase() === "content-security-policy").map((h) => h.value);

test("/byok carries its own strict policy, once, and the rest of the site never shares it", async ({ request }) => {
  const byok = await request.get(BYOK);
  expect(byok.status()).toBe(200);
  const [policy, ...more] = policies(byok.headersArray());
  expect(more).toEqual([]);
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'self';");
  expect(policy).toContain("connect-src 'self' https://queue.fal.run;");
  expect(policy).toContain("require-trusted-types-for 'script'");
  expect(policy).toContain("form-action 'none'");
  expect(policy).not.toContain("unsafe");
  expect(byok.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(byok.headers()["referrer-policy"]).toBe("no-referrer");
  expect(byok.headers()["x-content-type-options"]).toBe("nosniff");

  for (const path of ["/", "/byok/app.js"]) {
    const response = await request.get(path);
    expect(policies(response.headersArray()), path).toHaveLength(1);
  }
  const home = policies((await request.get("/")).headersArray())[0];
  expect(home).toContain("connect-src 'self';");
  expect(home).not.toContain("queue.fal.run");
});

test("the /byok script runs under that policy without a violation", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Trusted Type/i.test(message.text())) violations.push(message.text());
  });
  await page.goto(BYOK);
  await expect(page.getByRole("heading", { level: 1, name: "Render with your fal key" })).toBeVisible();
  // The plan request finishes either way (no approved storyboard yet answers a plain line), so the script ran.
  await expect(page.locator("#plan-status")).not.toHaveText("Loading the draft plan...");
  await expect(page.getByRole("link", { name: "Back to the report" })).toHaveAttribute("href", "/examples/food-hot-sauce");
  expect(violations).toEqual([]);
});
