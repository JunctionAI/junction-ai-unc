import { expect, type Locator, type Page } from "@playwright/test";

/* Shared helpers for the Phase 1 acceptance specs. */

/** Canned-reply stubs for the live Unc endpoints. The UI is designed to fall back to its
    deterministic copy whenever the endpoint answers { fallback: true }, so stubbing keeps
    the specs deterministic, offline and free (no Claude calls from the test run). */
export async function stubUncApi(page: Page) {
  await page.route("**/api/unc/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fallback: true }) }));
}

/** Freeze every CSS animation/transition at its 0% frame — jfloat (mascot), jpulse (live
    dots), toggle knobs, phase dots — so screenshots and layout assertions are deterministic.
    Applied to both the React port and the prototypes. */
export const FREEZE_CSS = `
  *, *::before, *::after {
    animation-play-state: paused !important;
    animation-delay: 0s !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;
export async function freezeMotion(page: Page) {
  await page.addStyleTag({ content: FREEZE_CSS });
}

/** Wait for React to attach to the server-rendered markup. Next dev serves SSR HTML first;
    a click before hydration is silently lost. React stamps `__reactFiber$…` keys on DOM nodes
    it owns, which is the cheapest reliable hydration signal. */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("button, input, a");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  });
}

/** Wait for web fonts + every <img> on the page (the 1.4 MB mascot included). */
export async function waitForAssets(page: Page) {
  await page.waitForFunction(async () => {
    await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    const imgs = Array.from(document.images);
    return imgs.every((i) => i.complete && (i.naturalWidth > 0 || !i.getAttribute("src")));
  });
}

/** Open the product at onboarding step 0 (hydrated, endpoints stubbed). */
export async function openApp(page: Page) {
  await stubUncApi(page);
  await page.goto("/app");
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "Skip — explore with demo data" })).toBeVisible();
}

/** Skip straight to the control centre with demo data. */
export async function openControlCentre(page: Page) {
  await openApp(page);
  await page.getByRole("button", { name: "Skip — explore with demo data" }).click();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
}

/** Sidebar navigation. The Routines item also renders its count ("Routines 35"). */
export const nav = {
  home: (p: Page) => p.getByRole("button", { name: "Home", exact: true }),
  strategy: (p: Page) => p.getByRole("button", { name: "Strategy", exact: true }),
  routines: (p: Page) => p.getByRole("button", { name: /^Routines\s+\d+$/ }),
  connectors: (p: Page) => p.getByRole("button", { name: "Connectors", exact: true }),
};

/** The 7 onboarding progress dots (6px-tall pills above the card). */
export const progressDots = (p: Page): Locator => p.locator(styled("span", "height:6px", "border-radius:999px"));

/** Straight vs typographic apostrophes/quotes are the one thing we don't treat as copy drift. */
export const normQuotes = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Colour assertion that survives Chromium's computed-style serialisation (oklch() specified values
    come back as lab(...)): the element's computed colour and the expected colour are both painted
    onto a 1×1 canvas and compared as sRGB + alpha (±3 per channel). `not` inverts the expectation. */
export async function expectColor(loc: Locator, prop: "background-color" | "border-color" | "color", expected: string, not = false) {
  await expect
    .poll(
      () =>
        loc.evaluate(
          (el, [p, exp]) => {
            const px = (css: string) => {
              const c = document.createElement("canvas");
              c.width = c.height = 1;
              const ctx = c.getContext("2d")!;
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = css;
              ctx.fillRect(0, 0, 1, 1);
              return Array.from(ctx.getImageData(0, 0, 1, 1).data);
            };
            const got = px(getComputedStyle(el).getPropertyValue(p));
            const want = px(exp);
            return got.every((v, i) => Math.abs(v - want[i]) <= 3);
          },
          [prop, expected] as [string, string],
        ),
      { timeout: 10_000, message: `${prop} ${not ? "is" : "is not"} ${expected}` },
    )
    .toBe(!not);
}

/** Inline-style attribute selector that matches both the server-rendered form (`width:26px`) and
    the client-rendered form (`width: 26px`) of a React inline style. */
export const styled = (tag: string, ...decls: string[]) => tag + decls.map((d) => `:is([style*="${d}"],[style*="${d.replace(":", ": ")}"])`).join("");
