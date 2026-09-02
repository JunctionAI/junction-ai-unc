import { expect, test } from "@playwright/test";
import { expectColor, normQuotes, waitForHydration } from "./helpers";

/* Landing page (/) — design-reference/Junction Landing.dc.html */

test.describe("Landing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
  });

  test("renders the hero copy verbatim and the pricing", async ({ page }) => {
    await expect(page).toHaveTitle(/Junction/);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    // Prototype: "Meet Unc: He'll help you grow your business" (straight apostrophe); the port renders a typographic one.
    expect(normQuotes(await h1.innerText())).toBe("Meet Unc: He'll help you grow your business");
    await expect(page.getByText("To get started, set a goal, and get to work together.")).toBeVisible();
    await expect(page.getByText(/5 quick questions and you.re away/)).toBeVisible();

    // Pricing block
    const pricing = page.locator("#pricing");
    await expect(pricing).toBeVisible();
    await expect(pricing.getByText("$100", { exact: true })).toBeVisible();
    await expect(pricing.getByText("14-day free trial")).toBeVisible();
    await expect(pricing.getByRole("button", { name: "Start your free trial" })).toBeVisible();

    // Founder proof + closer
    await expect(page.getByText(/We built Junction AI with 10\+ years of marketing expertise/)).toBeVisible();
    const closer = page.getByRole("heading", { name: /workaholic with one goal/ });
    await expect(closer).toBeVisible();
    expect(normQuotes(await closer.innerText())).toBe("He's a workaholic with one goal: to grow your business.");

    // Brand assets resolve (mascot + Tom)
    for (const src of ["/brand/mascot-small.png", "/brand/mascot.png", "/brand/tom.png"]) {
      const img = page.locator(`img[src="${src}"]`).first();
      await expect(img).toBeAttached();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  });

  test("AI / Human toggle swaps the mock chat thread", async ({ page }) => {
    const ai = page.getByRole("button", { name: "Junction AI" });
    const human = page.getByRole("button", { name: "Human support" });
    await ai.scrollIntoViewIfNeeded();

    // AI lane by default
    await expect(page.getByText(/Morning! Your ads: one.s winning, one.s not\. Move NZ\$40\/day to the winner\?/)).toBeVisible();
    await expect(page.getByText("Yes — do it.")).toBeVisible();
    await expect(page.getByText(/Receipt.s here if you ever want to check my work\./)).toBeVisible();
    await expectColor(ai, "background-color", "oklch(0.78 0.13 220)");
    await expectColor(human, "background-color", "rgba(0, 0, 0, 0)");

    // Switch to the human lane
    await human.click();
    await expect(page.getByText(/I can see your goal, strategy and receipts — never your credentials\. What are you wrestling with\?/)).toBeVisible();
    await expect(page.getByText("Can someone sanity-check my strategy?")).toBeVisible();
    await expect(page.getByText(/Morning! Your ads/)).toHaveCount(0);
    await expectColor(human, "background-color", "oklch(0.78 0.13 220)");
    await expectColor(ai, "background-color", "rgba(0, 0, 0, 0)");

    // …and back
    await ai.click();
    await expect(page.getByText(/Morning! Your ads/)).toBeVisible();
    await expect(page.getByText("Can someone sanity-check my strategy?")).toHaveCount(0);
  });

  test("every CTA links to /app and the hero CTA lands on onboarding step 0", async ({ page }) => {
    const ctas = page.locator('a[href="/app"]');
    const labels = await ctas.allInnerTexts();
    expect(labels.map((l) => l.trim())).toEqual(expect.arrayContaining(["Meet Unc", "Agree your first goal →", "Start your free trial", "Meet Unc →"]));
    expect(await ctas.count()).toBeGreaterThanOrEqual(4);
    // No CTA points anywhere else.
    const otherButtons = page.locator("a:not([href='/app']) button");
    await expect(otherButtons).toHaveCount(0);

    await page.getByRole("button", { name: "Agree your first goal →" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: /Hey! I.m Unc\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip — explore with demo data" })).toBeVisible();
  });
});
