import { expect, test } from "@playwright/test";
import { expectColor, normQuotes, waitForHydration } from "./helpers";

/* Landing page (/) — design-reference/Junction Landing.dc.html */

test.describe("Landing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
  });

  test("renders the hero copy verbatim, the waitlist capture and the pricing", async ({ page }) => {
    await expect(page).toHaveTitle(/Junction/);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    // Prototype: "Meet Unc: He'll help you grow your business" (straight apostrophe); the port renders a typographic one.
    expect(normQuotes(await h1.innerText())).toBe("Meet Unc: He'll help you grow your business");
    await expect(page.getByText("To get started, set a goal, and get to work together.")).toBeVisible();

    // Waitlist mode: the hero CTA row is the inline email capture, in Unc's voice.
    const hero = page.locator("#waitlist-hero");
    await expect(hero.getByRole("textbox", { name: "Your email" })).toBeVisible();
    await expect(hero.getByRole("button", { name: "Join the waitlist →" })).toBeVisible();
    expect(normQuotes(await hero.getByText(/onboarding founders in small groups/).innerText())).toBe("I'm onboarding founders in small groups — leave your email and I'll bring you in.");

    // Pricing block — the resolved locale's display price (US default off-Vercel) + trial badge; its button joins the waitlist too.
    const pricing = page.locator("#pricing");
    await expect(pricing).toBeVisible();
    await expect(pricing.getByText("US$100", { exact: true })).toBeVisible();
    await expect(pricing.getByText("/ month", { exact: true })).toBeVisible();
    await expect(pricing.getByText("14-day free trial")).toBeVisible();
    await expect(pricing.getByRole("button", { name: "Join the waitlist →" })).toBeVisible();

    // Founder proof + closer (with the second capture)
    await expect(page.getByText(/We built Junction AI with 10\+ years of marketing expertise/)).toBeVisible();
    const closer = page.getByRole("heading", { name: /workaholic with one goal/ });
    await expect(closer).toBeVisible();
    expect(normQuotes(await closer.innerText())).toBe("He's a workaholic with one goal: to grow your business.");
    await expect(page.locator("#waitlist-closer").getByRole("button", { name: "Join the waitlist →" })).toBeVisible();

    // Quiet legal footer
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "support@getjunction.ai" })).toHaveAttribute("href", "mailto:support@getjunction.ai");

    // Brand assets resolve (mascot + Tom)
    for (const src of ["/brand/mascot-small.png", "/brand/mascot.png", "/brand/tom.png"]) {
      const img = page.locator(`img[src="${src}"]`).first();
      await expect(img).toBeAttached();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  });

  test("?country=XX switches the pricing card and pins a cookie", async ({ page, context }) => {
    await page.goto("/?country=nz");
    await waitForHydration(page);
    await expect(page.locator("#pricing").getByText("NZ$149", { exact: true })).toBeVisible();
    const cookie = (await context.cookies()).find((c) => c.name === "unc_country");
    expect(cookie?.value).toBe("NZ");
    // The pin survives a plain visit; an unknown override is ignored (falls back to the pin).
    await page.goto("/");
    await waitForHydration(page);
    await expect(page.locator("#pricing").getByText("NZ$149", { exact: true })).toBeVisible();
    await page.goto("/?country=zz");
    await waitForHydration(page);
    await expect(page.locator("#pricing").getByText("NZ$149", { exact: true })).toBeVisible();
    await page.goto("/?country=GB");
    await waitForHydration(page);
    await expect(page.locator("#pricing").getByText("£79", { exact: true })).toBeVisible();
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

  test("every CTA is a waitlist action; no CTA links to /app", async ({ page }) => {
    // Nothing on the landing page links into the product any more.
    await expect(page.locator('a[href="/app"]')).toHaveCount(0);
    const ctas = page.getByRole("button", { name: /Join the waitlist/ });
    expect(await ctas.count()).toBe(4); // nav, hero form, pricing card, closer form

    // Nav → hero form focused.
    await page.getByRole("navigation").getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.locator("#waitlist-hero input[type=email]")).toBeFocused();

    // Pricing card → closer form focused.
    await page.locator("#pricing").getByRole("button", { name: "Join the waitlist →" }).click();
    await expect(page.locator("#waitlist-closer input[type=email]")).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });

  test("joining the waitlist: invalid email is refused inline, a valid one lands on the success state", async ({ page }) => {
    const posted: { email: string; source: string }[] = [];
    await page.route("**/api/waitlist", async (route) => {
      const body = route.request().postDataJSON() as { email: string; source: string };
      posted.push(body);
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email.trim().toLowerCase());
      await route.fulfill({ status: ok ? 200 : 400, contentType: "application/json", body: JSON.stringify(ok ? { ok: true } : { ok: false, error: "invalid_email" }) });
    });
    const hero = page.locator("#waitlist-hero");
    const input = hero.getByRole("textbox", { name: "Your email" });
    await input.fill("not-an-email");
    await hero.getByRole("button", { name: "Join the waitlist →" }).click();
    await expect(hero.getByText(/doesn.t look like an email/)).toBeVisible();
    await expect(input).toBeVisible();

    await input.fill("Founder@Example.test");
    await hero.getByRole("button", { name: "Join the waitlist →" }).click();
    const done = page.locator("#waitlist-hero");
    expect(normQuotes(await done.innerText())).toBe("You're on the list. I'll email you when it's your turn.");
    await expect(done.getByRole("textbox")).toHaveCount(0);
    expect(posted).toEqual([
      { email: "not-an-email", source: "hero" },
      { email: "Founder@Example.test", source: "hero" },
    ]);

    // The closer form is independent and reports its own source.
    const closer = page.locator("#waitlist-closer");
    await closer.getByRole("textbox", { name: "Your email" }).fill("second@example.test");
    await closer.getByRole("button", { name: "Join the waitlist →" }).click();
    await expect(closer.getByText(/You.re on the list/)).toBeVisible();
    expect(posted[2]).toEqual({ email: "second@example.test", source: "closer" });
  });

  test("/privacy and /terms render the legal documents with the company details", async ({ page }) => {
    for (const [path, title] of [
      ["/privacy", "Privacy Policy"],
      ["/terms", "Terms of Service"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText(/^Effective 2 September 2026$/)).toBeVisible();
      await expect(page.getByText("JUNCTION CENTRAL LIMITED").first()).toBeVisible();
      expect((await page.locator("main h2").count())).toBeGreaterThanOrEqual(10);
      await expect(page.getByRole("contentinfo").getByRole("link", { name: "support@getjunction.ai" })).toBeVisible();
    }
  });
});
