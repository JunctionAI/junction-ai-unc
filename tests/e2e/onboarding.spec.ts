import { expect, test, type Page } from "@playwright/test";
import { expectColor, openApp, progressDots } from "./helpers";

/* Onboarding — 7 steps (obStep 0–6), design-reference/README.md §A + §Interactions. */

const CYAN = "oklch(0.78 0.13 220)";
const SELECTED = { border: CYAN, bg: "oklch(0.94 0.03 225)" };

async function expectStep(page: Page, n: number, label?: string) {
  const dots = progressDots(page);
  await expect(dots).toHaveCount(7);
  for (let i = 0; i < 7; i++) {
    await expect(dots.nth(i)).toHaveCSS("width", i === n ? "26px" : "10px");
    await expectColor(dots.nth(i), "background-color", i <= n ? CYAN : "oklch(0.88 0.015 260)");
  }
  if (label) await expect(page.getByText(label, { exact: true })).toBeVisible();
}

const isSelected = async (btn: ReturnType<Page["getByRole"]>) => {
  await expectColor(btn, "border-color", SELECTED.border);
  await expectColor(btn, "background-color", SELECTED.bg);
};
const isUnselected = async (btn: ReturnType<Page["getByRole"]>) => {
  await btn.page().mouse.move(0, 0); // un-hover: .hov-border-cyan paints the same cyan border on hover
  await expectColor(btn, "border-color", SELECTED.border, true);
};

test.describe("Onboarding", () => {
  test("walks all 7 steps with realistic inputs and agrees the plan", async ({ page }) => {
    await openApp(page);

    /* ---- Step 0 · Welcome ---- */
    await expectStep(page, 0);
    await expect(page.getByRole("heading", { name: /Hey! I.m Unc\./ })).toBeVisible();
    await expect(page.getByText("My number one goal is to help you grow your business. Let's get started.").or(page.getByText("My number one goal is to help you grow your business. Let’s get started."))).toBeVisible();
    await expect(page.locator('img[src="/brand/mascot.png"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip — explore with demo data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "← Back" })).toHaveCount(0);
    await page.getByRole("button", { name: /Let.s go →/ }).click();

    /* ---- Step 1 · The goal ---- */
    await expectStep(page, 1, "Step 1 · The goal");
    await expect(page.getByRole("heading", { name: "What are you trying to grow?" })).toBeVisible();
    await expect(page.getByText("One clear goal beats five vague ones — and we can always change it later!")).toBeVisible();
    const revenue = page.getByRole("button", { name: "Revenue", exact: true });
    const leads = page.getByRole("button", { name: "Leads", exact: true });
    await isSelected(revenue);
    await isUnselected(leads);
    await leads.click(); // second selection = checkpoint, governing goal stays Revenue
    await isSelected(leads);
    await isSelected(revenue);
    await expect(page.getByText("Target MRR")).toBeVisible();

    // Currency first (the goal title re-derives from the currency at the time the target is typed)
    await expect(page.getByText("Currency", { exact: true })).toBeVisible();
    await isSelected(page.getByRole("button", { name: "NZD", exact: true }));
    await page.getByRole("button", { name: "AUD", exact: true }).click();
    await isSelected(page.getByRole("button", { name: "AUD", exact: true }));
    await isUnselected(page.getByRole("button", { name: "NZD", exact: true }));

    const target = page.getByLabel("Target MRR");
    const baseline = page.getByLabel("Where it is now");
    const byWhen = page.getByLabel("By when");
    await expect(target).toHaveValue("40000");
    await expect(baseline).toHaveValue("28400");
    await expect(byWhen).toHaveValue("2026-09-30");
    await target.fill("45000");
    await baseline.fill("30000");
    await byWhen.fill("2026-12-31");
    await expect(target).toHaveValue("45000");
    await expect(byWhen).toHaveValue("2026-12-31");

    // De-selecting the last remaining category is refused (the prototype guards it)
    await leads.click();
    await isUnselected(leads);
    await revenue.click();
    await isSelected(revenue);

    await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();
    await page.getByRole("button", { name: "Continue →" }).click();

    /* ---- Step 2 · Your data ---- */
    await expectStep(page, 2, "Step 2 · Your data");
    await expect(page.getByRole("heading", { name: "What platforms do you currently use?" })).toBeVisible();
    // Demo state: Shopify already connected (✓), Google Ads not.
    const shopify = page.getByRole("button", { name: /Shopify$/ });
    const gads = page.getByRole("button", { name: /Google Ads$/ });
    await expect(shopify).toHaveText("✓ Shopify");
    await expect(gads).toHaveText("Google Ads");
    await gads.click();
    await expect(gads).toHaveText("✓ Google Ads");
    await isSelected(gads);
    await shopify.click();
    await expect(shopify).toHaveText("Shopify");
    await isUnselected(shopify);
    await shopify.click(); // put it back so the demo connectors stay realistic
    await expect(shopify).toHaveText("✓ Shopify");
    await expect(page.getByRole("button", { name: /^✓ / })).toHaveCount(5); // Shopify, GA4, Meta Ads, Instagram + Google Ads (Slack is beyond the first 10 shown here)
    await page.getByRole("button", { name: "Continue →" }).click();

    /* ---- Step 3 · Your resources ---- */
    await expectStep(page, 3, "Step 3 · Your resources");
    await expect(page.getByRole("heading", { name: "What can you put into growth?" })).toBeVisible();
    await expect(page.getByText("Just what you’d spend on new growth — ads, content, tools, extra hands. Not your existing team or running costs.")).toBeVisible();

    const sliders = page.locator('input[type="range"]');
    const budget = sliders.nth(0);
    const hours = sliders.nth(1);
    await expect(budget).toHaveAttribute("max", "20000");
    await expect(budget).toHaveAttribute("step", "250");
    await expect(hours).toHaveAttribute("max", "100");

    // Budget: live label + per-day guardrail note, in the account currency chosen on step 1
    await expect(page.getByText("A$3,600/mo")).toBeVisible();
    await expect(page.getByText("≈ A$120/day — becomes the hard spend guardrail")).toBeVisible();
    await expect(page.getByText("A$0", { exact: true })).toBeVisible();
    await expect(page.getByText("A$20k/mo")).toBeVisible();
    await budget.fill("6000");
    await expect(page.getByText("A$6,000/mo")).toBeVisible();
    await expect(page.getByText("≈ A$200/day — becomes the hard spend guardrail")).toBeVisible();

    // Hours: note changes by range
    await expect(page.getByText("6 h/wk", { exact: true })).toBeVisible();
    await expect(page.getByText("Time spent on taste and approvals.")).toBeVisible();
    await hours.fill("2");
    await expect(page.getByText("2 h/wk", { exact: true })).toBeVisible();
    await expect(page.getByText("Approvals only — I draft everything, you decide.")).toBeVisible();
    await hours.fill("20");
    await expect(page.getByText("20 h/wk", { exact: true })).toBeVisible();
    await expect(page.getByText("Enough to own a channel yourself — I’ll build the machine around it.")).toBeVisible();
    await hours.fill("60");
    await expect(page.getByText("A full-time growth push — I’ll run like a whole department around you.")).toBeVisible();
    await hours.fill("8");
    await expect(page.getByText("8 h/wk", { exact: true })).toBeVisible();

    // Money side: margin slider + reinvestment picker
    await page.getByRole("button", { name: /Fine-tune the money side/ }).click();
    await expect(page.getByText("What you keep from each dollar (net margin)")).toBeVisible();
    await expect(page.getByText("30%", { exact: true })).toBeVisible();
    await page.locator('input[type="range"]').nth(2).fill("45");
    await expect(page.getByText("45%", { exact: true })).toBeVisible();
    await expect(page.getByText("As growth brings in new profit, how much goes back in?")).toBeVisible();
    const balanced = page.getByRole("button", { name: /^Balanced/ });
    const allIn = page.getByRole("button", { name: /^All-in/ });
    await isSelected(balanced);
    await expect(page.getByText(/The sweet spot for most growing businesses/)).toBeVisible();
    await allIn.click();
    await isSelected(allIn);
    await isUnselected(balanced);
    await expect(page.getByText(/Chasing speed — most new profit rolls straight back in/)).toBeVisible();
    await expect(allIn).toContainText("50–70% of new profit");

    // Team list: default row "You · Founder", add a person, remove them again
    await page.getByRole("button", { name: /Add your team/ }).click();
    const nameInputs = page.getByPlaceholder("Name");
    await expect(nameInputs).toHaveCount(1);
    await expect(nameInputs.first()).toHaveValue("You");
    await expect(page.locator("select").first()).toHaveValue("Founder");
    await page.getByRole("button", { name: "+ Add person" }).click();
    await expect(nameInputs).toHaveCount(2);
    await nameInputs.nth(1).fill("Priya");
    await page.locator("select").nth(1).selectOption("Content creator");
    await expect(page.locator("select").nth(1)).toHaveValue("Content creator");
    await page.getByRole("button", { name: "Content", exact: true }).nth(1).click(); // Priya approves Content
    await expect(page.getByText("Is responsible for approving")).toHaveCount(2);
    await page.getByTitle("Remove").nth(1).click();
    await expect(nameInputs).toHaveCount(1);
    await page.getByRole("button", { name: "Continue →" }).click();

    /* ---- Step 4 · Your strengths ---- */
    await expectStep(page, 4, "Step 4 · Your strengths");
    await expect(page.getByRole("heading", { name: "Where are you genuinely good?" })).toBeVisible();
    await expect(page.getByText("Skills", { exact: true })).toBeVisible();
    await expect(page.getByText("Platforms you know", { exact: true })).toBeVisible();
    await isSelected(page.getByRole("button", { name: "Writing", exact: true }));
    await isSelected(page.getByRole("button", { name: "Product", exact: true }));
    await isUnselected(page.getByRole("button", { name: "Video", exact: true }));
    await page.getByRole("button", { name: "Video", exact: true }).click();
    await isSelected(page.getByRole("button", { name: "Video", exact: true }));
    await isSelected(page.getByRole("button", { name: "Instagram", exact: true }));
    await page.getByRole("button", { name: "TikTok", exact: true }).click();
    await isSelected(page.getByRole("button", { name: "TikTok", exact: true }));
    await expect(page.getByText("Where can I learn about your business?")).toBeVisible();
    await page.getByPlaceholder("yourwebsite.com").fill("example.co.nz");
    await page.getByPlaceholder(/@instagram, @tiktok/).fill("@example");
    await expect(page.getByText(/I’ll scan these to understand your business, voice and market/)).toBeVisible();
    await page.getByRole("button", { name: "Continue →" }).click();

    /* ---- Step 5 · Your way ---- */
    await expectStep(page, 5, "Step 5 · Your way");
    await expect(page.getByRole("heading", { name: "How do you believe you should grow?" })).toBeVisible();
    const brand = page.getByRole("button", { name: /^Brand-led organic/ });
    const sales = page.getByRole("button", { name: /^Sales-led outbound/ });
    const paid = page.getByRole("button", { name: /^Paid-led scale/ });
    await expectColor(brand, "border-color", CYAN);
    await expectColor(sales, "border-color", CYAN, true);
    await expect(brand).toContainText("Matches 4 of your picks"); // Writing, Video + Instagram, TikTok

    // Back keeps state (Video/TikTok picks survive the round trip)
    await page.getByRole("button", { name: "← Back" }).click();
    await expectStep(page, 4, "Step 4 · Your strengths");
    await isSelected(page.getByRole("button", { name: "Video", exact: true }));
    await isSelected(page.getByRole("button", { name: "TikTok", exact: true }));
    await expect(page.getByPlaceholder("yourwebsite.com")).toHaveValue("example.co.nz");
    await page.getByRole("button", { name: "Continue →" }).click();
    await expectStep(page, 5, "Step 5 · Your way");

    await paid.click();
    await expectColor(paid, "border-color", CYAN);
    await expectColor(brand, "border-color", CYAN); // multi-select
    const focused = page.getByRole("button", { name: /^Focused — few channels, deep/ });
    const broad = page.getByRole("button", { name: /^Broad — as many channels running as possible/ });
    await isSelected(focused);
    await broad.click();
    await isSelected(broad);
    await isUnselected(focused);
    await page.getByRole("button", { name: "Continue →" }).click();

    /* ---- Step 6 · Agree the plan ---- */
    await expectStep(page, 6, "Step 6 · Agree the plan");
    await expect(page.getByRole("heading", { name: /Unc.s plan for you/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue →" })).toHaveCount(0);
    await expect(page.getByText("Brand-led organic + Paid-led scale, run broad across channels")).toBeVisible();
    // Math line: gap = 45,000 − 30,000 in the account currency; A$6,000/mo → A$200/day; 8 h/wk
    await expect(page.getByText("Your goal needs A$15,000 of new ground by 31 Dec. With A$200/day and 8 h/wk of you, here’s the shortest path I can see:")).toBeVisible();
    // Three numbered, time-bound phases
    for (const n of ["1", "2", "3"]) await expect(page.getByText(n, { exact: true }).filter({ has: page.locator(":scope") })).toBeVisible();
    await expect(page.getByText(/Weeks 1–\d+: our world-class content routines, built around what you do best\./)).toBeVisible();
    await expect(page.getByText(/Weeks \d+–\d+: we add [a-z& ]+ — .+ Focus: converting the momentum into revenue\./)).toBeVisible();
    await expect(page.getByText(/Weeks \d+–\d+ and beyond: .+ switch on as their numbers earn it\./)).toBeVisible();
    await expect(page.getByText("I do the work — you bring taste and okays. I’ll scan your site and socials tonight and sharpen this before anything runs.")).toBeVisible();
    // Site scan was attempted (endpoint stubbed → honest fallback line)
    await expect(page.getByText("Couldn’t reach your site — I’ll use what you told me.")).toBeVisible();

    // Pushback chat (endpoint stubbed → canned reply)
    const pushback = page.getByPlaceholder("Push back or ask why — we agree it together…");
    await pushback.fill("Why content before paid?");
    await pushback.press("Enter");
    await expect(page.getByText("Why content before paid?")).toBeVisible();
    await expect(page.getByText("Good push — folded into the draft. You’ll see it reflected in Strategy, and we keep reshaping it there as the data comes in.")).toBeVisible();
    await expect(pushback).toHaveValue("");

    // Step 6 has no Back/Continue row (same as the prototype: obMid = steps 1–5) — only the CTA
    await expect(page.getByRole("button", { name: "← Back" })).toHaveCount(0);

    // Agree → control centre carries the agreed goal + currency
    await page.getByRole("button", { name: "Agree the plan →" }).click();
    await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    const goalInput = page.locator('input[value="A$45,000 MRR"]');
    await expect(goalInput).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-12-31");
    await expect(page.getByText(/· \d+ days left/)).toContainText("122 days left"); // demo clock 31 Aug → 31 Dec
    await expect(page.getByText(/Ad spend starts at A\$200\/day and only grows from wins: about 60% of new profit rolls back in/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip — explore with demo data" })).toHaveCount(0);
  });

  test("Skip lands on the control centre with demo data", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Skip — explore with demo data" }).click();
    await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
    await expect(page.locator('input[value="NZ$40,000 MRR"]')).toBeVisible();
    await expect(page.getByText("Goal", { exact: true })).toHaveCount(0); // v2 has no "Goal" label — the title is the header
    await expect(page.getByText("Demonstration data.")).toBeVisible();
    await expect(page.getByRole("button", { name: /In your corner/ })).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-09-30");
  });
});
