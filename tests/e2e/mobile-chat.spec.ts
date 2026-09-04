import { expect, test } from "@playwright/test";
import { openControlCentre } from "./helpers";

// UI-only fixture. It proves phone layout and status handling, not AVGAR/provider execution.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test("mobile chat stays inside the screen and retains a fixture conversation when reopened", async ({ page }) => {
  await openControlCentre(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.route("**/api/unc/chat", route => route.fulfill({ json: { reply: "your fixture draft is ready. nothing has been published." } }));
  await page.getByRole("button", { name: /In your corner\s+Ask me anything/ }).click();
  const panel = page.getByRole("region", { name: "Chat with Unc" });
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  const input = page.getByPlaceholder("Ask for work, a change, an explanation…");
  await input.fill("show a fixture draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("your fixture draft is ready. nothing has been published.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await page.getByRole("button", { name: /In your corner\s+Ask me anything/ }).click();
  await expect(page.getByText("your fixture draft is ready. nothing has been published.", { exact: true })).toBeVisible();
});
