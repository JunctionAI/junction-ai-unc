import { expect, test } from "@playwright/test";
import { openControlCentre } from "./helpers";

// UI contract only: model, queue and provider responses are stubbed. No customer work runs.
test("chat shows queued, waiting and completed states without inventing completion", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openControlCentre(page);
  let requestId: unknown;
  let polls = 0;
  await page.route("**/api/unc/chat", async (route) => {
    requestId = route.request().postDataJSON().requestId;
    await route.fulfill({ json: { reply: "Queued the SEO analysis. It has not finished yet.", commandId: "30000000-0000-0000-0000-000000000001", status: "queued" } });
  });
  await page.route("**/api/unc/commands?*", async (route) => {
    polls += 1;
    await route.fulfill({ json: polls === 1 ? { status: "waiting", reply: "The workflow is still running." } : { status: "done", reply: "The SEO draft is ready to review. No live changes were made." } });
  });
  await page.getByRole("button", { name: /In your corner\s+Ask me anything/ }).click();
  await page.getByPlaceholder("Ask for work, a change, an explanation…").fill("Run the SEO analysis");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Queued the SEO analysis. It has not finished yet.", { exact: true })).toBeVisible();
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByText("The SEO draft is ready to review. No live changes were made.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The workflow is still running.", { exact: true })).toBeVisible();
  await expect(page.getByText("The SEO draft is ready to review. No live changes were made.", { exact: true })).toBeVisible();
  expect(polls).toBe(2);
  expect(errors).toEqual([]);
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0);
});

test("blocked command status does not become a successful completion", async ({ page }) => {
  await openControlCentre(page);
  await page.route("**/api/unc/chat", (route) => route.fulfill({ json: { reply: "Your request is queued.", commandId: "30000000-0000-0000-0000-000000000002" } }));
  await page.route("**/api/unc/commands?*", (route) => route.fulfill({ json: { status: "blocked", reply: "This routine was switched off before execution. Nothing was started." } }));
  await page.getByRole("button", { name: /In your corner\s+Ask me anything/ }).click();
  await page.getByPlaceholder("Ask for work, a change, an explanation…").fill("Run founder content");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("This routine was switched off before execution. Nothing was started.", { exact: true })).toBeVisible();
});

test("failed status lookup surfaces uncertainty without claiming completion", async ({ page }) => {
  await openControlCentre(page);
  await page.route("**/api/unc/chat", route => route.fulfill({ json: { reply: "queued, not completed.", commandId: "30000000-0000-0000-0000-000000000003" } }));
  await page.route("**/api/unc/commands?*", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.getByRole("button", { name: /In your corner\s+Ask me anything/ }).click();
  await page.getByPlaceholder("Ask for work, a change, an explanation…").fill("run the routine");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("i can’t confirm this run’s status right now. check Routines before requesting the same work again.", { exact: true })).toBeVisible();
});
