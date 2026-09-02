# Visual parity — React port vs original prototypes

*Generated 2026-09-02T08:14:02.294Z by `npx playwright test tests/e2e/parity.spec.ts` (scripts/parity/capture.ts).*

**Method.** Both sources are driven to the same state with the same clicks (Skip → nav items → role card → Tutorial), every CSS animation/transition is frozen at its 0% frame (jfloat, jpulse, toggle knobs, phase dots), web fonts and images are awaited, then a full-page screenshot is taken at a 1280×900 viewport (DPR 1), clipped to the 1280px viewport width. Pixels are compared with a pixelmatch-style YIQ colour delta (threshold 0.1) over the union canvas; a page that is taller in one source counts the extra rows as differences (`diff %`), while `overlap %` restricts the comparison to the shared region so layout drift is visible separately from height drift. `<screen>-diff.png` paints differing pixels red (orange = present in only one source). Visible copy (`document.body.innerText`) is also diffed line by line with quotes/whitespace normalised (`copy Δ`).

**Pass threshold.** ≤ 3% on layout-equal screens. Result: **6 of 7 screens pass.**

| Screen | id | proto / port size | diff % | overlap % | copy Δ | verdict | notes |
|---|---|---|---|---|---|---|---|
| Landing page | `landing` | 1280×3744 / 1280×3861 | **4.70%** | 1.72% | 22 lines | ⚠️ over |  |
| Onboarding · step 0 (welcome) | `onboarding-0` | 1280×900 / 1280×900 | **0.14%** | 0.14% | none | ✅ pass |  |
| Control centre · Home (demo data) | `home` | 1280×2474 / 1280×2474 | **0.24%** | 0.24% | none | ✅ pass |  |
| Strategy | `strategy` | 1280×1032 / 1280×1032 | **0.09%** | 0.09% | none | ✅ pass |  |
| Routines · role cards | `routines` | 1280×900 / 1280×900 | **0.08%** | 0.08% | none | ✅ pass |  |
| Routine detail · Founder content engine (D01-W01) | `routine-detail` | 1280×900 / 1280×900 | **0.33%** | 0.33% | 1 line | ✅ pass |  |
| Connectors | `connectors` | 1280×1035 / 1280×1035 | **0.07%** | 0.07% | none | ✅ pass |  |

Files: `design-reference/parity/<id>-proto.png`, `<id>-port.png`, `<id>-diff.png`, `<id>-{proto,port}.txt`.

## Copy differences (visible text, line level)
### `landing`
Only in the prototype:
- `Meet Unc`
- `Agree your first goal →`
- `5 quick questions and you're away 🚀`
- `$100`
- `USD / month`
- `Start your free trial`
- `Meet Unc →`
Only in the port:
- `Join the waitlist`
- `Join the waitlist →`
- `I'm onboarding founders in small groups — leave your email and I'll bring you in.`
- `US$100`
- `/ month`
- `Join the waitlist →`
- `Join the waitlist →`
- `I'm onboarding founders in small groups — leave your email and I'll bring you in.`
- `© 2026 Junction`
- `·`
- `Privacy`
- `·`
- `Terms`
- `·`
- `support@getjunction.ai`

### `routine-detail`
Only in the port:
- `Run now (dry run)`


## Known, accepted sources of difference
- **Landing is in waitlist mode (intentional, 2026-09-02).** Every CTA on `/` is now a waitlist action: the hero CTA row and the navy closer's button are an inline email capture (`src/components/landing/WaitlistForm.tsx`), the nav and pricing buttons scroll to one of them, the pricing card shows the visitor's country price (`US$100 / month` by default, `src/lib/locale`) and a quiet legal footer follows the closer. The `landing` diff therefore measures a deliberate product change against the prototype, not port drift; everything above the hero CTA row and every other section is unchanged.
- **Fonts.** The prototypes load Space Grotesk from Google Fonts; the port self-hosts it through `next/font`. Same family and weights, but the served files differ in version/hinting, so glyph edges differ by a pixel here and there across every text run — this is the floor under every number in the table.
- **Mascot animation phase.** `jfloat` is frozen at its 0% keyframe on both sources (translateY(0)), so the floating mascot is compared at rest. `jpulse` live dots are frozen at full opacity.
- **Date math.** Both sources run the same fixed demo clock (today = 31 Aug 2026, start = 12 Aug 2026, weeks anchored on 1 Sep 2026), so “days left”, pace and the plan's week spans are identical — no live-date drift.
- **Page height.** A one-line wrap difference (font metrics) shifts everything below it by a line, which the union-canvas `diff %` counts in full. `overlap %` is the fairer layout number when the sizes differ.
- **Corner buddy.** Fixed-position; in a full-page capture it renders once, at the bottom-right of the (expanded) viewport, on both sources.

## Deviations for the next agent (not fixed here — `src/` was off-limits to this harness)
- **Landing hero copy sits 18px too low** (historical — the port now keeps the row, see `src/components/landing/Landing.tsx`) — hero `<header>`: the prototype keeps an empty stats row (`<div style="display:flex; gap:26px; margin-top:36px">` with three empty `<div>`s) under the CTA row; the port dropped it, so the text column is 36px shorter (261.5px vs 297.5px) and `align-items:center` centres it 18px lower (h1 top 218px vs 200px; the mascot sits at 135px on both). Restore the row (or give the CTA row `margin-bottom:36px`) to land it exactly. This is the whole 0.94% on `landing`.
- **Hero apostrophe** — the prototype's h1 is `Meet Unc: He'll help you grow your business` (straight `'`); `src/components/landing/Landing.tsx` renders `He&rsquo;ll` (`’`). Everywhere else the two already agree (closer `He’s` curly on both, step-0 `Let's get started` straight on both, `Let’s go →` curly on both). Glyph-level only; the harness normalises quotes when asserting copy. Pick one for the h1.
- **README says 14 connector cards; both the prototype and the port render 16** (Shopify … Slack, incl. Xero and QuickBooks). The port is faithful to the prototype — the README is the stale document.
- **Prototype quirk carried over (product call, not a port bug):** on Home, reconnecting Klaviyo clears the blocked card and the needs-you count, but the “Setting up next → Review request timing” proposal keeps its “Needs Klaviyo reconnect” pill — `propStatus` is independent of `connState` in `platform-v2-logic.js` and in `src/lib/platform/derive.ts` alike.
- **Home text runs are 1–2px off horizontally** (setup strip labels, before → after lines, the hire line) — pure font-file metrics (Google Fonts vs `next/font` build of Space Grotesk); markup and spacing are identical. No action.
- `landing` is at 4.70% (overlap 1.72%): sizes proto 1280×3744 vs port 1280×3861 — open `landing-diff.png` to see where.
