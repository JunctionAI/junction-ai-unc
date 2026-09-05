import { expect, test } from "@playwright/test";

// Current supplied v2. Response fixtures prove UI behaviour, not live persistence.
test.describe("Landing v2", () => {
  test("real navigation and concrete-work copy render without application errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/");
    await expect(page).toHaveTitle(/Sales and marketing agents/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Grow your business.*sales and marketing agents/);
    await page.getByRole("button", { name: "Join the private beta", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Your email" })).toBeFocused();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "/privacy");
    await page.getByRole("link", { name: "Sign in", exact: true }).first().click();
    await expect(page).toHaveURL(/\/login/);
    expect(errors).toEqual([]);
  });
  test("explorer interests reach signup without calling routine APIs", async ({ page }) => {
    const posted: unknown[] = []; const runtimeCalls: string[] = [];
    page.on("request", r => { if (/\/api\/(routines|connectors|unc)\//.test(r.url())) runtimeCalls.push(r.url()); });
    await page.route("**/api/waitlist", async route => { posted.push(route.request().postDataJSON()); await route.fulfill({ status: 200, json: { ok: true } }); });
    await page.goto("/");
    await page.getByRole("button", { name: /^SEO Find/ }).click();
    await page.getByRole("checkbox", { name: "Find keyword opportunities" }).check();
    await expect(page.getByText("Interests: SEO.")).toBeVisible();
    await page.getByRole("textbox", { name: "Your email" }).fill(" Founder@Example.test ");
    await page.getByRole("button", { name: "Join the waitlist →", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your signup is recorded");
    expect(posted).toEqual([{ email: "founder@example.test", source: "landing_v2-seo" }]);
    expect(runtimeCalls).toEqual([]);
  });
  test("invalid email stays local and bad confirmations never look successful", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/waitlist", async route => { calls++; await route.fulfill({ status: calls === 1 ? 503 : 200, json: calls === 1 ? { ok: true } : {} }); });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "Your email" });
    const submit = page.getByRole("button", { name: "Join the waitlist →", exact: true });
    await input.fill("not-an-email"); await submit.click();
    await expect(input).toHaveAttribute("aria-invalid", "true"); expect(calls).toBe(0);
    await input.fill("fixture@example.test"); await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "couldn’t confirm" })).toBeVisible();
    await expect(input).toBeVisible(); await submit.click();
    await expect(page.getByRole("alert").filter({ hasText: "couldn’t confirm" })).toBeVisible();
    await expect(page.getByText("Your signup is recorded", { exact: false })).toHaveCount(0);
  });
  test("an in-flight request is guarded and rate limits can be retried", async ({ page }) => {
    let calls = 0; let release!: () => void; const held = new Promise<void>(r => { release = r; });
    await page.route("**/api/waitlist", async route => { calls++; if (calls === 1) { await held; await route.fulfill({ status: 429, json: { ok: false, error: "rate_limited" } }); } else await route.fulfill({ status: 200, json: { ok: true } }); });
    await page.goto("/");
    await page.getByRole("textbox", { name: "Your email" }).fill("fixture@example.test");
    await page.getByRole("button", { name: "Join the waitlist →", exact: true }).click();
    await expect(page.getByRole("button", { name: "One sec…" })).toBeDisabled();
    expect(calls).toBe(1); release();
    await expect(page.getByRole("alert").filter({ hasText: "Too many attempts" })).toBeVisible();
    await page.getByRole("button", { name: "Join the waitlist →", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your signup is recorded"); expect(calls).toBe(2);
  });
  for (const width of [390, 1280]) test(`layout and open states fit ${width}px without overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/");
    await page.getByRole("button", { name: /^Content Stay/ }).click();
    await page.getByRole("checkbox", { name: "Draft posts in your voice" }).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText("Interests: Content.")).toBeVisible();
    await page.locator("summary").filter({ hasText: "What does it cost?" }).click();
    await expect(page.getByText(/Pricing, inclusions and limits will be explained/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
  });
  test("legal pages still render their real documents", async ({ page }) => {
    for (const [url, name] of [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"]]) {
      await page.goto(url); await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByText("JUNCTION CENTRAL LIMITED").first()).toBeVisible();
    }
  });
});
