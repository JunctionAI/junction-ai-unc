/* Visual parity capture — prototype (.dc.html, served by tests/e2e/global-setup.ts) vs the
   React port (Next dev server on :3400). Both are driven to the same state through the same
   clicks, motion is frozen, and matched full-page screenshots are written to
   design-reference/parity/<screen>-{proto,port}.png. Run through Playwright:

     npx playwright test tests/e2e/parity.spec.ts

   (tests/e2e/parity.spec.ts is the runner; this module owns the screen list, the drivers and
   the capture/compare/report plumbing.) */

import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page } from "@playwright/test";
import { comparePngs, type CompareResult } from "./compare";

export const PARITY_DIR = path.resolve(__dirname, "../../design-reference/parity");
export const VIEWPORT = { width: 1280, height: 900 };
/** Layout-equal screens must land at or under this. */
export const PASS_THRESHOLD_PCT = 3;

export type Source = "proto" | "port";

export interface Screen {
  id: string;
  title: string;
  /** Drive the page from the previous screen's state to this one. Same steps on both sources. */
  drive: (page: Page, src: Source) => Promise<void>;
  /** Something that must be visible before capture (state settled on both sources). */
  settle?: (page: Page) => Promise<void>;
}

export const PROTO_LANDING = "Junction Landing.dc.html";
export const PROTO_PLATFORM = "Junction Platform v2.dc.html";

const FREEZE_CSS = `
  *, *::before, *::after {
    animation-play-state: paused !important;
    animation-delay: 0s !important;
    transition: none !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  ::-webkit-scrollbar { display: none; }
`;

export function protoUrl(file: string): string {
  const base = process.env.PROTO_BASE;
  if (!base) throw new Error("PROTO_BASE is not set — run through `npx playwright test` so global-setup serves design-reference/");
  return `${base}/${encodeURIComponent(file)}`;
}

/** Wait until React owns the DOM (Next hydration) — the prototype renders client-side too, so
    the same check works for both sources. */
async function waitForReact(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("button, input, a");
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber"));
  });
}

export async function settlePage(page: Page) {
  await page.waitForFunction(async () => {
    await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    return Array.from(document.images).every((i) => i.complete && (i.naturalWidth > 0 || !i.getAttribute("src")));
  });
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Let the corner-buddy scroll-spy timers fire (150 ms after a view change, 400 ms after mount on
  // both sources) so the contextual bubble is in the same state in every capture.
  await page.waitForTimeout(450);
}

/** The prototype's <helmet> block puts its Google Fonts link + keyframes in the template; the
    runtime hoists them. Fonts only matter for pixel parity, so give them a bounded wait. */
async function waitForSpaceGrotesk(page: Page) {
  await page
    .waitForFunction(() => (document as Document & { fonts: FontFaceSet }).fonts.check("600 16px 'Space Grotesk'") || Array.from((document as Document & { fonts: FontFaceSet }).fonts).some((f) => f.family.includes("Space") && f.status === "loaded"), null, { timeout: 15_000 })
    .catch(() => {});
}

/* ---------------------------------------------------------------- drivers */

const skipBtn = (p: Page) => p.getByRole("button", { name: "Skip — explore with demo data" });
const navBtn = {
  home: (p: Page) => p.getByRole("button", { name: "Home", exact: true }),
  strategy: (p: Page) => p.getByRole("button", { name: "Strategy", exact: true }),
  routines: (p: Page) => p.getByRole("button", { name: /^Routines\s+\d+$/ }),
  connectors: (p: Page) => p.getByRole("button", { name: "Connectors", exact: true }),
};

export const SCREENS: Screen[] = [
  {
    id: "landing",
    title: "Landing page",
    drive: async (page, src) => {
      await page.goto(src === "proto" ? protoUrl(PROTO_LANDING) : "/");
      await waitForReact(page);
      await waitForSpaceGrotesk(page);
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Meet Unc");
      await expect(page.getByRole("button", { name: "Junction AI" })).toBeVisible();
    },
  },
  {
    id: "onboarding-0",
    title: "Onboarding · step 0 (welcome)",
    drive: async (page, src) => {
      await page.goto(src === "proto" ? protoUrl(PROTO_PLATFORM) : "/app");
      await waitForReact(page);
      await waitForSpaceGrotesk(page);
    },
    settle: async (page) => {
      await expect(skipBtn(page)).toBeVisible();
    },
  },
  {
    id: "home",
    title: "Control centre · Home (demo data)",
    drive: async (page) => {
      await skipBtn(page).click();
    },
    settle: async (page) => {
      await expect(navBtn.home(page)).toBeVisible();
      await expect(page.getByText(/^(On track|Behind by NZ\$[\d,]+)$/)).toBeVisible();
      // scroll-spy bubble (150–400 ms timers on both sources; the last matching section wins → needs-you)
      await expect(page.getByText("Only you can clear these. Three taps and the machine keeps moving without you.")).toBeVisible();
    },
  },
  {
    id: "strategy",
    title: "Strategy",
    drive: async (page) => {
      await navBtn.strategy(page).click();
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "Strategy" })).toBeVisible();
      await expect(page.getByText("The build-out", { exact: true })).toBeVisible();
      await expect(page.getByText("We agree the strategy once — then the routines carry it. Your job becomes clearing agreed work, not remembering it.")).toBeVisible();
    },
  },
  {
    id: "routines",
    title: "Routines · role cards",
    drive: async (page) => {
      await navBtn.routines(page).click();
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Content\s*Get seen consistently/ })).toBeVisible();
    },
  },
  {
    id: "routine-detail",
    title: "Routine detail · Founder content engine (D01-W01)",
    drive: async (page) => {
      await page.getByRole("button", { name: /^Content\s*Get seen consistently/ }).click();
      await expect(page.getByRole("button", { name: "Tutorial →" }).first()).toBeVisible();
      await page.getByRole("button", { name: "Tutorial →" }).first().click();
    },
    settle: async (page) => {
      await expect(page.getByRole("button", { name: "← All routines" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Founder content engine" })).toBeVisible();
      await expect(page.getByText("v12 · active")).toBeVisible();
      // (the detail view's data-buddy sits on the 20px-tall back link, whose bottom never clears the
      //  80px scroll-spy floor — so no bubble shows here on either source)
    },
  },
  {
    id: "connectors",
    title: "Connectors",
    drive: async (page) => {
      await navBtn.connectors(page).click();
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible();
      await expect(page.getByText(/Least privilege, always — I list every scope before you approve it/)).toBeVisible();
    },
  },
];

/* ---------------------------------------------------------------- capture + report */

export interface ScreenResult extends CompareResult {
  id: string;
  title: string;
  pass: boolean;
  note: string;
  /** Visible-text lines (normalised) present only in the prototype / only in the port. */
  textOnlyProto: string[];
  textOnlyPort: string[];
}

export async function captureScreen(page: Page, screen: Screen, src: Source): Promise<string> {
  await screen.drive(page, src);
  if (screen.settle) await screen.settle(page);
  await settlePage(page);
  fs.mkdirSync(PARITY_DIR, { recursive: true });
  // Visible copy, for the text-level diff (catches copy drift the pixel diff can only hint at).
  const text = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(PARITY_DIR, `${screen.id}-${src}.txt`), text);
  const file = path.join(PARITY_DIR, `${screen.id}-${src}.png`);
  // Full page, clipped to the viewport width: the prototype runtime's <image-slot> parks an
  // off-canvas SVG at x≈1320 that widens the landing document to 1482px — a runtime artefact,
  // not design — so both sources are measured on the same 1280px-wide canvas.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: VIEWPORT.width, height }, animations: "disabled", caret: "hide" });
  return file;
}

const normLine = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Multiset difference of visible-text lines, order preserved. */
function textDiff(a: string, b: string): { onlyA: string[]; onlyB: string[] } {
  const la = a.split("\n").map(normLine).filter(Boolean);
  const lb = b.split("\n").map(normLine).filter(Boolean);
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<string, number>());
  const ca = count(la);
  const cb = count(lb);
  const onlyA = la.filter((x) => {
    const n = cb.get(x) || 0;
    if (n > 0) {
      cb.set(x, n - 1);
      return false;
    }
    return true;
  });
  const onlyB = lb.filter((x) => {
    const n = ca.get(x) || 0;
    if (n > 0) {
      ca.set(x, n - 1);
      return false;
    }
    return true;
  });
  return { onlyA, onlyB };
}

export function compareScreen(screen: Screen, note = ""): ScreenResult {
  const proto = path.join(PARITY_DIR, `${screen.id}-proto.png`);
  const port = path.join(PARITY_DIR, `${screen.id}-port.png`);
  const diff = path.join(PARITY_DIR, `${screen.id}-diff.png`);
  const r = comparePngs(proto, port, diff);
  const t = textDiff(fs.readFileSync(path.join(PARITY_DIR, `${screen.id}-proto.txt`), "utf8"), fs.readFileSync(path.join(PARITY_DIR, `${screen.id}-port.txt`), "utf8"));
  return { id: screen.id, title: screen.title, ...r, pass: r.diffPct <= PASS_THRESHOLD_PCT, note, textOnlyProto: t.onlyA, textOnlyPort: t.onlyB };
}

export function writeReport(results: ScreenResult[], extraNotes: string[], bugs: string[]): string {
  const now = new Date().toISOString();
  const fmt = (n: number) => n.toFixed(2) + "%";
  const rows = results
    .map((r) => {
      const size = `${r.protoSize.width}×${r.protoSize.height} / ${r.portSize.width}×${r.portSize.height}`;
      const copy = r.textOnlyProto.length + r.textOnlyPort.length;
      return `| ${r.title} | \`${r.id}\` | ${size} | **${fmt(r.diffPct)}** | ${fmt(r.overlapDiffPct)} | ${copy ? `${copy} line${copy === 1 ? "" : "s"}` : "none"} | ${r.pass ? "✅ pass" : "⚠️ over"} | ${r.note} |`;
    })
    .join("\n");
  const passN = results.filter((r) => r.pass).length;
  const copySections = results
    .filter((r) => r.textOnlyProto.length || r.textOnlyPort.length)
    .map(
      (r) =>
        `### \`${r.id}\`\n` +
        (r.textOnlyProto.length ? `Only in the prototype:\n${r.textOnlyProto.map((l) => `- \`${l}\``).join("\n")}\n` : "") +
        (r.textOnlyPort.length ? `Only in the port:\n${r.textOnlyPort.map((l) => `- \`${l}\``).join("\n")}\n` : ""),
    )
    .join("\n");
  const md = `# Visual parity — React port vs original prototypes

*Generated ${now} by \`npx playwright test tests/e2e/parity.spec.ts\` (scripts/parity/capture.ts).*

**Method.** Both sources are driven to the same state with the same clicks (Skip → nav items → role card → Tutorial), every CSS animation/transition is frozen at its 0% frame (jfloat, jpulse, toggle knobs, phase dots), web fonts and images are awaited, then a full-page screenshot is taken at a 1280×900 viewport (DPR 1), clipped to the 1280px viewport width. Pixels are compared with a pixelmatch-style YIQ colour delta (threshold 0.1) over the union canvas; a page that is taller in one source counts the extra rows as differences (\`diff %\`), while \`overlap %\` restricts the comparison to the shared region so layout drift is visible separately from height drift. \`<screen>-diff.png\` paints differing pixels red (orange = present in only one source). Visible copy (\`document.body.innerText\`) is also diffed line by line with quotes/whitespace normalised (\`copy Δ\`).

**Pass threshold.** ≤ ${PASS_THRESHOLD_PCT}% on layout-equal screens. Result: **${passN} of ${results.length} screens pass.**

| Screen | id | proto / port size | diff % | overlap % | copy Δ | verdict | notes |
|---|---|---|---|---|---|---|---|
${rows}

Files: \`design-reference/parity/<id>-proto.png\`, \`<id>-port.png\`, \`<id>-diff.png\`, \`<id>-{proto,port}.txt\`.

## Copy differences (visible text, line level)
${copySections || "None — every visible line matches once quotes and whitespace are normalised."}

## Known, accepted sources of difference
${extraNotes.map((n) => `- ${n}`).join("\n")}

## Deviations for the next agent (not fixed here — \`src/\` was off-limits to this harness)
${bugs.length ? bugs.map((b) => `- ${b}`).join("\n") : "- none found"}
`;
  fs.writeFileSync(path.join(PARITY_DIR, "REPORT.md"), md);
  fs.writeFileSync(path.join(PARITY_DIR, "results.json"), JSON.stringify(results, null, 2));
  return md;
}
