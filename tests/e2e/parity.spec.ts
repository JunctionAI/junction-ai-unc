import { expect, test, type Page } from "@playwright/test";
import { captureScreen, compareScreen, PASS_THRESHOLD_PCT, SCREENS, writeReport, type ScreenResult, type Source, VIEWPORT } from "../../scripts/parity/capture";
import { stubUncApi } from "./helpers";

/* Visual parity runner. One page per source, both walked through the same screen sequence;
   captures land in design-reference/parity/ and REPORT.md is regenerated at the end.
   Serial + single worker: the screens build on each other's state. */

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const results: ScreenResult[] = [];

test.describe("Visual parity", () => {
  let proto: Page;
  let port: Page;

  test.beforeAll(async ({ browser }) => {
    const ctxA = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const ctxB = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    proto = await ctxA.newPage();
    port = await ctxB.newPage();
    await stubUncApi(port);
  });

  test.afterAll(async () => {
    await proto.context().close();
    await port.context().close();
  });

  for (const screen of SCREENS) {
    test(`${screen.id} — ${screen.title}`, async () => {
      const pages: [Source, Page][] = [
        ["proto", proto],
        ["port", port],
      ];
      for (const [src, page] of pages) {
        await captureScreen(page, screen, src);
      }
      const r = compareScreen(screen);
      results.push(r);
      // Informational: the verdict is in REPORT.md. Only a wildly broken capture fails the run.
      expect(r.diffPct, `${screen.id}: ${r.diffPct.toFixed(2)}% differs (threshold ${PASS_THRESHOLD_PCT}%) — see design-reference/parity/${screen.id}-diff.png`).toBeLessThan(60);
    });
  }

  test("write REPORT.md", async () => {
    expect(results.length).toBe(SCREENS.length);
    const notes = [
      "**Fonts.** The prototypes load Space Grotesk from Google Fonts; the port self-hosts it through `next/font`. Same family and weights, but the served files differ in version/hinting, so glyph edges differ by a pixel here and there across every text run — this is the floor under every number in the table.",
      "**Mascot animation phase.** `jfloat` is frozen at its 0% keyframe on both sources (translateY(0)), so the floating mascot is compared at rest. `jpulse` live dots are frozen at full opacity.",
      "**Date math.** Both sources run the same fixed demo clock (today = 31 Aug 2026, start = 12 Aug 2026, weeks anchored on 1 Sep 2026), so “days left”, pace and the plan's week spans are identical — no live-date drift.",
      "**Page height.** A one-line wrap difference (font metrics) shifts everything below it by a line, which the union-canvas `diff %` counts in full. `overlap %` is the fairer layout number when the sizes differ.",
      "**Corner buddy.** Fixed-position; in a full-page capture it renders once, at the bottom-right of the (expanded) viewport, on both sources.",
    ];
    /* Hand-verified deviations (measured with getBoundingClientRect on both sources at 1280×900). */
    const bugs: string[] = [
      "**Landing hero copy sits 18px too low** — `src/app/page.tsx` hero `<header>`: the prototype keeps an empty stats row (`<div style=\"display:flex; gap:26px; margin-top:36px\">` with three empty `<div>`s) under the CTA row; the port dropped it, so the text column is 36px shorter (261.5px vs 297.5px) and `align-items:center` centres it 18px lower (h1 top 218px vs 200px; the mascot sits at 135px on both). Restore the row (or give the CTA row `margin-bottom:36px`) to land it exactly. This is the whole 0.94% on `landing`.",
      "**Hero apostrophe** — the prototype's h1 is `Meet Unc: He'll help you grow your business` (straight `'`); `src/app/page.tsx` renders `He&rsquo;ll` (`’`). Everywhere else the two already agree (closer `He’s` curly on both, step-0 `Let's get started` straight on both, `Let’s go →` curly on both). Glyph-level only; the harness normalises quotes when asserting copy. Pick one for the h1.",
      "**README says 14 connector cards; both the prototype and the port render 16** (Shopify … Slack, incl. Xero and QuickBooks). The port is faithful to the prototype — the README is the stale document.",
      "**Prototype quirk carried over (product call, not a port bug):** on Home, reconnecting Klaviyo clears the blocked card and the needs-you count, but the “Setting up next → Review request timing” proposal keeps its “Needs Klaviyo reconnect” pill — `propStatus` is independent of `connState` in `platform-v2-logic.js` and in `src/lib/platform/derive.ts` alike.",
      "**Home text runs are 1–2px off horizontally** (setup strip labels, before → after lines, the hire line) — pure font-file metrics (Google Fonts vs `next/font` build of Space Grotesk); markup and spacing are identical. No action.",
    ];
    // Anything over threshold is listed explicitly so it can be triaged.
    for (const r of results) {
      if (!r.pass) bugs.push(`\`${r.id}\` is at ${r.diffPct.toFixed(2)}% (overlap ${r.overlapDiffPct.toFixed(2)}%): sizes proto ${r.protoSize.width}×${r.protoSize.height} vs port ${r.portSize.width}×${r.portSize.height} — open \`${r.id}-diff.png\` to see where.`);
    }
    const md = writeReport(results, notes, bugs);
    console.log("\n" + md);
  });
});
