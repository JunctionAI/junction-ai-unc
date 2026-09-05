import { test, expect } from "@playwright/test";
const base = process.env.WORKSPACE_FIXTURE_BASE;
test.skip(!base, "Isolated synthetic fixture only; no live account or provider.");
const fixture = () => ({ accountId: "aa5cfc84-2569-4c99-9b40-67003ae55eda", actorId: "74802c60-149a-4405-b719-dc058d174072",
  contextGeneration: 1, routineId: "D05-W07", timezone: null as string | null, updatedAt: null as string | null,
  canEdit: true, bound: false, paused: true, executedAction: "none" });
const url = () => `${base}/tests/calendar-preferences-fixture/index.html`;
test("explicit choice saves and reloads without enabling or dispatch", async ({ page }) => {
  const saved = fixture(), posts: string[] = [], errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { if (r.method() === "POST") posts.push(r.url()); });
  await page.route("**/api/routines/calendar-preferences", async r => {
    if (r.request().method() === "POST") {
      expect(r.request().headers()["x-unc-actor-id"]).toBe(saved.actorId);
      expect(r.request().postDataJSON()).toEqual({ timezone: "Pacific/Auckland", expectedUpdatedAt: null });
      saved.timezone = "Pacific/Auckland"; saved.updatedAt = "2026-09-06T00:00:00.123456+00:00";
    } await r.fulfill({ json: saved });
  });
  await page.goto(url()); await expect(page.getByLabel("Calendar timezone", { exact: true })).toHaveValue("");
  await page.getByLabel("Calendar timezone", { exact: true }).fill("Pacific/Auckland"); await page.getByRole("button", { name: "Save timezone" }).click();
  await expect(page.getByText("Calendar timezone saved. No routine was enabled and nothing was scheduled or sent.")).toBeVisible();
  await page.reload(); await expect(page.getByLabel("Calendar timezone", { exact: true })).toHaveValue("Pacific/Auckland");
  expect(posts).toEqual([`${base}/api/routines/calendar-preferences`]); expect(errors).toEqual([]);
});
test("lost save reply requires readback and never reposts", async ({ page }) => {
  const saved = fixture(); let posts = 0;
  await page.route("**/api/routines/calendar-preferences", async r => {
    if (r.request().method() === "POST") { posts++; saved.timezone = "UTC"; saved.updatedAt = "2026-09-06T00:00:00Z"; await r.abort("failed"); }
    else await r.fulfill({ json: saved });
  });
  await page.goto(url()); await page.getByLabel("Calendar timezone", { exact: true }).fill("UTC"); await page.getByRole("button", { name: "Save timezone" }).click();
  await expect(page.getByText(/Save not confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh settings" }).click(); await expect(page.getByLabel("Calendar timezone", { exact: true })).toHaveValue("UTC"); expect(posts).toBe(1);
});
test("context change discards late save reply", async ({ page }) => {
  let finish = () => {}, started = () => {};
  const release = new Promise<void>(r => { finish = r; }), pending = new Promise<void>(r => { started = r; });
  await page.route("**/api/routines/calendar-preferences", async r => {
    if (r.request().method() === "POST") { started(); await release; await r.fulfill({ json: { ...fixture(), timezone: "UTC", updatedAt: "2026-09-06T00:00:00Z" } }).catch(() => {}); }
    else await r.fulfill({ json: { ...fixture(), contextGeneration: Number(r.request().headers()["x-unc-context-generation"]) } });
  });
  await page.goto(url()); await page.getByLabel("Calendar timezone", { exact: true }).fill("UTC"); await page.getByRole("button", { name: "Save timezone" }).click(); await pending;
  await page.getByRole("button", { name: "Change business context" }).click(); finish();
  await expect(page.getByLabel("Calendar timezone", { exact: true })).toHaveValue(""); await expect(page.getByText(/Calendar timezone saved/)).toHaveCount(0);
});
test("bound or outstanding work locks changes; invalid timezone cannot be submitted", async ({ page }) => {
  await page.route("**/api/routines/calendar-preferences", r => r.fulfill({ json: { ...fixture(), canEdit: false, bound: true } }));
  await page.goto(url()); await expect(page.getByLabel("Calendar timezone", { exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Save timezone" })).toBeDisabled();
  await page.unroute("**/api/routines/calendar-preferences"); await page.route("**/api/routines/calendar-preferences", r => r.fulfill({ json: fixture() }));
  await page.getByRole("button", { name: "Refresh settings" }).click(); await page.getByLabel("Calendar timezone", { exact: true }).fill("made up timezone");
  await expect(page.getByRole("button", { name: "Save timezone" })).toBeDisabled();
});
for (const width of [390,1280]) test(`calendar setup fits ${width}px`, async ({ page }) => {
  await page.route("**/api/routines/calendar-preferences", r => r.fulfill({ json: fixture() }));
  await page.setViewportSize({ width, height: 850 }); await page.goto(url()); await expect(page.getByLabel("Calendar timezone", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`calendar-settings-${width}.png`), fullPage: true });
});
