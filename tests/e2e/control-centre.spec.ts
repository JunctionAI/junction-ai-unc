import { expect, test, type Page } from "@playwright/test";
import { expectColor, nav, openControlCentre, styled } from "./helpers";

/* Control centre — Home, Strategy, Routines (list → detail → workflow editing), Connectors,
   corner buddy. design-reference/README.md §B–§F + §Interactions. Demo data throughout. */

const CYAN = "oklch(0.78 0.13 220)";

/** The amber "needs you" count next to Unc's review bubble. */
const needsPill = (page: Page) => page.getByText(/give me the okay/).locator("span");

test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await openControlCentre(page);
  });

  test("goal header, status pill, progress and the plain sentence", async ({ page }) => {
    const goal = page.locator('input[value="NZ$40,000 MRR"]');
    await expect(goal).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toHaveValue("2026-09-30");
    // Demo clock: today 31 Aug 2026 → 30 days to 30 Sep.
    await expect(page.getByText("· 30 days left")).toBeVisible();
    // Demo math: baseline 28,400 → 31,650 over 19 days = NZ$171.05/day; lands at 36,782 → behind by 3,218.
    const pill = page.getByText(/^(On track|Behind by NZ\$[\d,]+)$/);
    await expect(pill).toHaveText("Behind by NZ$3,218");
    await expectColor(pill, "background-color", "oklch(0.93 0.05 80)"); // amber wash = a decision waits
    await expect(page.getByText("You need NZ$8,350 more by the deadline. You’re a little behind — the plan below closes the gap. Your part is below.")).toBeVisible();

    // Editing the deadline re-derives days left + status
    const date = page.locator('input[type="date"]').first();
    await date.fill("2026-12-31");
    await expect(page.getByText("· 122 days left")).toBeVisible();
    await expect(pill).toHaveText("On track");
    await expectColor(pill, "background-color", "oklch(0.94 0.03 225)");
    await expect(page.getByText(/Right now you’re on pace\. Keep clearing your part below\./)).toBeVisible();

    // Editing the goal title re-parses the target
    await goal.fill("NZ$60,000 MRR");
    await expect(pill).toHaveText(/^Behind by NZ\$[\d,]+$/);

    // Setup strip, plan timeline, the bar, automation level, setting-up-next, receipts
    await expect(page.getByText("Platforms connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "5 of 16 — connect more →" })).toBeVisible();
    await expect(page.getByText("The plan", { exact: true })).toBeVisible();
    await expect(page.getByText("Content — your strength, running first")).toBeVisible();
    await expect(page.getByText("Now", { exact: true })).toBeVisible();
    await expect(page.getByText("Next", { exact: true })).toBeVisible();
    await expect(page.getByText("Later", { exact: true })).toBeVisible();
    await expect(page.getByText("The bar", { exact: true })).toBeVisible();
    await expect(page.getByText("5 posts / week")).toBeVisible();
    await expect(page.getByText("22% of customers")).toBeVisible();
    await expect(page.getByText("< 4 h to leads")).toBeVisible();
    await expect(page.getByText("At the bar ✓")).toBeVisible();
    await expect(page.getByText("Below the bar")).toHaveCount(2);
    await expect(page.getByText("Automation level")).toBeVisible();
    await expect(page.getByText(/— \d+ of 36 routines running · saving you ~\d+ h\/week/)).toBeVisible();
    await expect(page.getByText("Setting up next")).toBeVisible();
    await expect(page.getByText("Completed today")).toBeVisible();
    await expect(page.getByText("Receipt R-4482")).toBeVisible();

    // "The bar" fix button jumps to the relevant routines category
    await page.getByRole("button", { name: "Switch on the flows" }).click();
    await expect(page.getByRole("heading", { name: "Email & SMS" })).toBeVisible();
    await expect(page.getByRole("button", { name: "← All roles" })).toBeVisible();
  });

  test("Approve, Hold and Why? on the needs-you list", async ({ page }) => {
    // 3 pending approvals + the expired Klaviyo connector = 4
    await expect(needsPill(page)).toHaveText("4");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(3);
    await expect(page.getByText("Shift NZ$40/day into Advantage+ retargeting")).toBeVisible();
    await expect(page.getByText("D02-W01", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("expires in 18h")).toBeVisible();

    // Why? toggles the reasoning bubble
    await page.getByRole("button", { name: "Why?" }).first().click();
    const why1 = page.getByText(/Certified 7-day ROAS: Prospecting-B 1\.4×, Advantage\+ 3\.1×/);
    await expect(why1).toBeVisible();
    await expectColor(why1, "background-color", "oklch(0.94 0.03 225)");
    await page.getByRole("button", { name: "Why?" }).first().click();
    await expect(why1).toHaveCount(0);

    // Approve → user-side confirmation bubble + Unc receipt; count decrements
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("On it — executing only the approved scope, reading the result back, then receipt R-4491 lands here.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(2);
    await expect(needsPill(page)).toHaveText("3");

    // Hold → held bubble; count decrements
    await page.getByRole("button", { name: "Hold" }).first().click();
    await expect(page.getByText("Hold for now")).toBeVisible();
    await expect(page.getByText("Held. I’ll re-surface it tomorrow with fresh numbers — nothing moves meanwhile.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(1);
    await expect(needsPill(page)).toHaveText("2");

    // Reasoning for the last one, then approve it
    await page.getByRole("button", { name: "Why?" }).click();
    await expect(page.getByText(/All 412 lapsed 60–180 days/)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/All 412 lapsed 60–180 days/)).toHaveCount(0); // reasoning only shows while pending
    await expect(page.getByText("receipt R-4493 lands here")).toBeVisible();
    await expect(needsPill(page)).toHaveText("1");

    // Blocked connector card → Reconnect clears the last item
    await expect(page.getByText("Klaviyo token expired — 2 minutes to fix")).toBeVisible();
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect(page.getByText("Reconnected Klaviyo")).toBeVisible();
    await expect(page.getByText(/Token verified, freshness green/)).toBeVisible();
    await expect(needsPill(page)).toHaveText("0");
    await expect(page.getByText(/Nothing needs you right now — the machine is running/)).toBeVisible();
    // Faithful to the prototype: the "Setting up next" proposal keeps its blocked pill after the
    // reconnect (propStatus is independent of connState in platform-v2-logic.js too). Product call, not a port bug.
    await expect(page.getByText("Needs Klaviyo reconnect")).toHaveCount(1);
    await expect(page.getByText("6 connected · 0 needs attention · 10 available →")).toBeVisible(); // sidebar summary
  });

  test("Setting up next: Turn on → building", async ({ page }) => {
    await expect(page.getByText("Welcome flow tuning")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn on" })).toHaveCount(1);
    await expect(page.getByText("Building · dry run tonight")).toHaveCount(1);
    await page.getByRole("button", { name: "Turn on" }).click();
    await expect(page.getByRole("button", { name: "Turn on" })).toHaveCount(0);
    await expect(page.getByText("Building · dry run tonight")).toHaveCount(2);
  });
});

test.describe("Strategy", () => {
  test("posture cards, why-this-is-yours and the build-out", async ({ page }) => {
    await openControlCentre(page);
    await nav.strategy(page).click();
    await expect(page.getByRole("heading", { name: "Strategy" })).toBeVisible();
    await page.mouse.move(0, 0); // un-hover the nav item (hover paints a lighter navy)
    await expectColor(nav.strategy(page), "background-color", "oklch(0.36 0.06 262)"); // active = lighter navy + cyan dot
    await expect(page.getByText("agreed 12 Aug · reviewed monthly · persists until superseded")).toBeVisible();

    const brand = page.getByRole("button", { name: /^CURRENT PLAY.*Brand-led organic/ });
    const sales = page.getByRole("button", { name: /Sales-led outbound/ });
    const paid = page.getByRole("button", { name: /Paid-led scale/ });
    await expect(brand).toContainText("YOURS");
    await expectColor(brand, "border-color", CYAN);
    await expect(sales).not.toContainText("YOURS");
    await expect(paid).not.toContainText("YOURS");
    await expect(page.getByText("Why this is yours")).toBeVisible();
    await expect(page.getByText(/Chosen with you on 12 Aug\. Your budget caps paid, your writing is the asset/)).toBeVisible();
    await expect(page.getByText(/Right now that’s shaped by ≤ NZ\$120\/day for paid, 6 h\/wk of your time, and your strengths: writing, product\./)).toBeVisible();

    // Multi-select: adding a posture keeps the first one governing
    await sales.click();
    await expect(sales).toContainText("YOURS");
    await expect(brand).toContainText("YOURS");
    await sales.click();
    await expect(sales).not.toContainText("YOURS");
    // The last remaining posture cannot be removed
    await brand.click();
    await expect(brand).toContainText("YOURS");

    // Build-out: 4 phases, evidence gates, routine counts, manage → Routines
    await expect(page.getByText("The build-out", { exact: true })).toBeVisible();
    await expect(page.getByText("Organic brand engine")).toBeVisible();
    await expect(page.getByText("ACTIVE", { exact: true })).toBeVisible();
    await expect(page.getByText("Retention & lifecycle")).toBeVisible();
    await expect(page.getByText("NOW", { exact: true })).toBeVisible();
    await expect(page.getByText("GATED · repeat ≥ 18%")).toBeVisible();
    await expect(page.getByText("GATED · NZ$40k MRR")).toBeVisible();
    await expect(page.getByRole("button", { name: "manage" })).toHaveCount(4);
    await expect(page.getByText(/^3 routines ·/)).toHaveCount(2);
    await expect(page.getByText(/^2 routines ·/)).toHaveCount(2);
    await expect(page.getByText(/From you:/)).toHaveCount(4);
    await page.getByRole("button", { name: "manage" }).first().click();
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
  });
});

test.describe("Routines", () => {
  test.beforeEach(async ({ page }) => {
    await openControlCentre(page);
    await nav.routines(page).click();
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
  });

  test("role cards → toggle rows → on/off updates the counts", async ({ page }) => {
    await expect(nav.routines(page)).toContainText("35");
    const roles: [string, string][] = [
      ["Content", "Get seen consistently"],
      ["Paid ads", "Make every dollar work harder"],
      ["SEO", "Get found on Google"],
      ["Sales", "Fill your calendar with right-fit buyers"],
      ["Email & SMS", "Keep customers coming back"],
    ];
    for (const [name, tagline] of roles) {
      const card = page.getByRole("button", { name: new RegExp(`^${name.replace(/[&]/g, "&")}\\s*${tagline}`) });
      await expect(card).toBeVisible();
      await expect(card).toContainText(/\d+ of \d+ on/);
    }
    const content = page.getByRole("button", { name: /^Content\s*Get seen consistently/ });
    const onBefore = Number((await content.innerText()).match(/(\d+) of 8 on/)![1]);
    await content.click();

    await expect(page.getByRole("button", { name: "← All roles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Content" })).toBeVisible();
    await expect(page.getByText("Get seen consistently")).toBeVisible();
    const toggles = page.getByTitle("On / off");
    await expect(toggles).toHaveCount(8);
    await expect(page.getByText("Posts in your voice, drafted for you")).toBeVisible();
    await expect(page.getByText(/Founder content engine · saves ~\d h\/wk/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Tutorial →" })).toHaveCount(8);

    // Toggle the first routine (Founder content engine — Active in demo data → switches off)
    const first = toggles.first();
    const knob = first.locator("span");
    await expectColor(first, "background-color", "oklch(0.72 0.17 150)");
    await expect(knob).toHaveCSS("left", "19.5px");
    await first.click();
    await expectColor(first, "background-color", "oklch(0.88 0.015 260)");
    await expect(knob).toHaveCSS("left", "2.5px");
    // Switch a second one on
    const third = toggles.nth(2);
    await expectColor(third, "background-color", "oklch(0.88 0.015 260)");
    await third.click();
    await expectColor(third, "background-color", "oklch(0.72 0.17 150)");
    // …and the first back on → net +1
    await first.click();
    await expectColor(first, "background-color", "oklch(0.72 0.17 150)");

    await page.getByRole("button", { name: "← All roles" }).click();
    await expect(page.getByRole("button", { name: /^Content\s*Get seen consistently/ })).toContainText(`${onBefore + 1} of 8 on`);
    // Home's automation strip reflects it too
    await nav.home(page).click();
    await expect(page.getByText(new RegExp(`${onBefore + 1}/8 · ${8 - onBefore - 1} to unlock`))).toBeVisible();
  });

  test("routine detail: node canvas → inspector → draft → dry-run → promote increments the version", async ({ page }) => {
    await page.getByRole("button", { name: /^Content\s*Get seen consistently/ }).click();
    await page.getByRole("button", { name: "Tutorial →" }).first().click();

    await expect(page.getByRole("button", { name: "← All routines" })).toBeVisible();
    await expect(page.getByText("D01-W01 · Content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Founder content engine" })).toBeVisible();
    await expect(page.getByText("Turns real customer questions into founder-voice posts, staged for one-tap approval.")).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText("Trigger & cadence")).toBeVisible();
    await expect(page.getByText("Write mode")).toBeVisible();
    await expect(page.getByText("KPI", { exact: true })).toBeVisible();

    // Workflow canvas: 7-node chain, first node selected by default
    const tags = ["TRIGGER", "READ", "CHECK", "DECIDE", "GATE", "EXECUTE", "RECEIPT"];
    const nodes = page.locator(styled("button", "width:128px"));
    await expect(nodes).toHaveCount(7);
    for (let i = 0; i < tags.length; i++) await expect(nodes.nth(i)).toContainText(tags[i]);
    await expectColor(nodes.nth(0), "border-color", CYAN);
    await expectColor(nodes.nth(3), "border-color", CYAN, true);
    const version = page.getByText(/^v\d+ · (active|draft|validated)$/);
    await expect(version).toHaveText("v12 · active");
    await expect(page.getByRole("button", { name: "Run dry-run validation" })).toHaveCount(0);

    // Inspector follows the selected node
    await expect(page.getByText("Schedule", { exact: true }).last()).toBeVisible();
    await nodes.nth(3).click();
    await expectColor(nodes.nth(3), "border-color", CYAN);
    await expectColor(nodes.nth(0), "border-color", CYAN, true);
    await expect(page.getByText("Skill decision", { exact: true }).last()).toBeVisible();
    const skillVersion = page.getByLabel("Skill version");
    await expect(skillVersion).toHaveValue("v12");
    const bound = page.getByLabel("Bound");
    await expect(bound).toHaveValue("≤ NZ$120/day");

    // Editing a param creates a draft version
    await bound.fill("≤ NZ$100/day");
    await expect(version).toHaveText("v13 · draft");
    await expectColor(version, "background-color", "oklch(0.93 0.05 80)"); // amber: a decision waits
    await expect(page.getByText("Edits create version v13 (draft). Junction validates it against this system’s acceptance tests before it can run in production.")).toBeVisible();
    const validate = page.getByRole("button", { name: "Run dry-run validation" });
    await expect(validate).toBeVisible();
    await expect(page.getByRole("button", { name: "Promote to production" })).toHaveCount(0);

    // The edit survives switching nodes
    await nodes.nth(4).click();
    await expect(page.getByLabel("Approver")).toHaveValue("Tom");
    await nodes.nth(3).click();
    await expect(bound).toHaveValue("≤ NZ$100/day");

    // Dry-run → validated → promote → v13 active
    await validate.click();
    await expect(version).toHaveText("v13 · validated");
    await expect(page.getByText("Validation passed on demonstration data — promote when you’re ready. The previous version stays available for rollback.")).toBeVisible();
    await expect(validate).toHaveCount(0);
    const promote = page.getByRole("button", { name: "Promote to production" });
    await promote.click();
    await expect(version).toHaveText("v13 · active");
    await expectColor(version, "background-color", "oklch(0.94 0.03 225)");
    await expect(promote).toHaveCount(0);
    await expect(skillVersion).toHaveValue("v13");

    // A second edit starts v14
    await bound.fill("≤ NZ$90/day");
    await expect(version).toHaveText("v14 · draft");

    // Setup wizard: 4 steps → dry run scheduled
    await page.getByRole("button", { name: "Set this up" }).click();
    await expect(page.getByText("Set up Founder content engine")).toBeVisible();
    await expect(page.getByText("— step 1 of 4 · dry-run before anything goes live")).toBeVisible();
    await expect(page.getByText("Klaviyo — reconnect")).toBeVisible();
    await page.getByRole("button", { name: "Sources look right" }).click();
    await expect(page.getByText("— step 2 of 4 · dry-run before anything goes live")).toBeVisible();
    await page.getByRole("button", { name: "Definitions confirmed" }).click();
    await page.getByRole("button", { name: "Provided — keep going" }).click();
    await expect(page.getByText("— step 4 of 4 · dry-run before anything goes live")).toBeVisible();
    await page.getByRole("button", { name: "Start dry run" }).click();
    await expect(page.getByText("Dry run scheduled tonight — zero outward actions. The result and receipt land in Home tomorrow morning.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set this up" })).toHaveCount(0);

    // Back to the list
    await page.getByRole("button", { name: "← All routines" }).click();
    await expect(page.getByRole("button", { name: "← All roles" })).toBeVisible();
  });
});

test.describe("Routines — Run now (dry run)", () => {
  test("manual trigger shows the receipt trail and an honest missing-context ask in demo mode", async ({ page }) => {
    await openControlCentre(page);
    await nav.routines(page).click();
    await page.getByRole("button", { name: /^Content\s*Get seen consistently/ }).click();
    await page.getByRole("button", { name: "Tutorial →" }).first().click();
    await expect(page.getByText("D01-W01 · Content")).toBeVisible();

    // The ghost pill sits with the workflow inspector; the draft-only validate button is absent until an edit.
    const runNow = page.getByRole("button", { name: "Run now (dry run)" });
    await expect(runNow).toBeVisible();
    await expect(page.getByRole("button", { name: "Run dry-run validation" })).toHaveCount(0);
    // The pill sits inline in the receipts strip; the explanatory note appears with the trail after a run.
    await expect(page.getByText(/Demo mode: runs live in memory and vanish when the server restarts/)).toHaveCount(0);

    // POSTs /api/routines/run for this routine and renders id · kind · description rows
    const [req] = await Promise.all([page.waitForRequest((r) => r.url().endsWith("/api/routines/run") && r.method() === "POST"), runNow.click()]);
    expect(req.postDataJSON()).toMatchObject({ accountId: "demo", routineId: "D01-W01" });
    const trail = page.getByTestId("run-trail");
    await expect(trail).toBeVisible();
    const rows = page.getByTestId("run-trail-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    await expect(rows.first()).toContainText("read");
    await expect(rows.first().locator("span").first()).toHaveText(/^[0-9a-f]{8}$/);
    await expect(rows.first()).toContainText(/Read /);
    // Demo mode has no persisted business profile. The real producer must ask for that
    // minimum instead of fabricating a founder-voice draft or claiming completion.
    await expect(page.getByText(/^I need something from you/)).toBeVisible();
    await expect(page.getByTestId("run-needs")).toContainText("about the business");
    await expect(page.getByLabel("about the business")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send answers and draft" })).toBeDisabled();
    await expect(page.getByText(/Demo mode: runs live in memory and vanish when the server restarts/)).toBeVisible();
    // dry run only: no mutation receipt, ever
    await expect(page.getByTestId("run-trail-row").filter({ hasText: /^\S+\s*mutation/ })).toHaveCount(0);
  });
});

test.describe("Connectors", () => {
  test("grid statuses match the summary; Reconnect / Connect flip a card", async ({ page }) => {
    await openControlCentre(page);
    await nav.connectors(page).click();
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    await expect(page.getByText(/Exact, least-privilege connections to the systems that hold your source truth/)).toBeVisible();

    const connected = page.getByText("Connected", { exact: true });
    const reconnect = page.getByRole("button", { name: "Reconnect" });
    const connect = page.getByRole("button", { name: "Connect", exact: true });
    await expect(connected).toHaveCount(5);
    await expect(reconnect).toHaveCount(1);
    await expect(connect).toHaveCount(10);
    await expect(page.getByText("5 connected · 1 needs attention · 10 available")).toHaveCount(2); // page header + sidebar
    await expect(page.getByText(/unlocks \d+ routines/)).toHaveCount(16);
    await expect(page.getByText("orders · products · customers · unlocks 12 routines")).toBeVisible();
    for (const name of ["Shopify", "Google Analytics 4", "Meta Ads", "Google Ads", "Klaviyo", "Instagram", "TikTok", "LinkedIn", "YouTube", "Google Search Console", "HubSpot", "Gmail", "Gorgias", "Xero", "QuickBooks", "Slack"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }

    await reconnect.click();
    await expect(connected).toHaveCount(6);
    await expect(reconnect).toHaveCount(0);
    await expect(page.getByText("6 connected · 0 needs attention · 10 available")).toHaveCount(2);

    await connect.first().click(); // Google Ads
    await expect(connected).toHaveCount(7);
    await expect(connect).toHaveCount(9);
    await expect(page.getByText("7 connected · 0 needs attention · 9 available")).toHaveCount(2);

    // Home reflects the change
    await nav.home(page).click();
    await expect(page.getByRole("button", { name: "7 of 16 — connect more →" })).toBeVisible();
    await expect(page.getByText("Klaviyo token expired — 2 minutes to fix")).toHaveCount(0);
  });
});

test.describe("Corner buddy", () => {
  test("opens/closes the chat popover; toggle swaps lanes; sends in both", async ({ page }) => {
    await openControlCentre(page);
    const buddy = page.getByRole("button", { name: /In your corner\s+Ask me anything/ });
    await expect(buddy).toBeVisible();
    // Contextual bubble. Scroll-spy rule (same as the prototype's _buddyTick): the LAST [data-buddy]
    // section whose top sits above 55% of the viewport wins — at scroll 0 that is the needs-you section.
    const bubble = page.getByText("Only you can clear these. Three taps and the machine keeps moving without you.");
    await expect(bubble).toBeVisible();

    await buddy.click();
    const popover = page.locator(styled("div", "width:372px", "height:480px"));
    await expect(popover).toBeVisible();
    await expect(bubble).toHaveCount(0); // hidden while chat is open
    await expect(popover.getByText("Junction", { exact: true })).toBeVisible();
    await expect(popover.getByText("In your corner · knows your numbers")).toBeVisible();
    const aiTab = popover.getByRole("button", { name: "Junction AI" });
    const humanTab = popover.getByRole("button", { name: "Human support" });
    await expectColor(aiTab, "background-color", CYAN);
    await expectColor(humanTab, "background-color", "rgba(0, 0, 0, 0)");
    await expect(popover.getByText(/Morning Tom\. Overnight I completed the weekly brief/)).toBeVisible();
    await expect(popover.getByText("Why shift budget away from Prospecting-B?")).toBeVisible();
    await expect(popover.getByPlaceholder("Ask for work, a change, an explanation…")).toBeVisible();

    // AI lane send (endpoint stubbed → canned reply lands after the typing indicator)
    const input = popover.locator("input");
    await input.fill("Draft me two posts about our new range");
    await popover.getByRole("button", { name: "Send" }).click();
    await expect(popover.getByText("Draft me two posts about our new range")).toBeVisible();
    await expect(popover.getByText(/Understood\. I’ll map that to the right system, run it read-only first/)).toBeVisible();
    await expect(input).toHaveValue("");

    // Human lane
    await humanTab.click();
    await expectColor(humanTab, "background-color", CYAN);
    await expectColor(aiTab, "background-color", "rgba(0, 0, 0, 0)");
    await expect(popover.getByText("Human support", { exact: true }).first()).toBeVisible();
    await expect(popover.getByText("Real people who know your setup · reply within hours")).toBeVisible();
    await expect(popover.getByText(/Kia ora — Sam from the Junction team/)).toBeVisible();
    await expect(popover.getByText(/Morning Tom\./)).toHaveCount(0);
    await expect(popover.getByPlaceholder("Ask Sam anything — strategy, setup, a second opinion…")).toBeVisible();
    await input.fill("Can you sanity-check the retention plan?");
    await input.press("Enter");
    await expect(popover.getByText("Can you sanity-check the retention plan?")).toBeVisible();
    await expect(popover.getByText(/Got it — I have your account context in front of me/)).toBeVisible();

    // Back to AI: the AI thread is intact and the deep link opens the routine
    await aiTab.click();
    await expect(popover.getByText("Draft me two posts about our new range")).toBeVisible();
    await popover.getByRole("button", { name: "Inspect the system →" }).click();
    await expect(page.getByRole("heading", { name: "Daily paid decisioning" })).toBeVisible();
    await expect(page.getByText("D02-W01 · Paid ads")).toBeVisible();

    // Close via × and via the buddy button
    await popover.getByRole("button", { name: "×" }).click();
    await expect(popover).toHaveCount(0);
    await buddy.click();
    await expect(popover).toBeVisible();
    await buddy.click();
    await expect(popover).toHaveCount(0);
  });
});
