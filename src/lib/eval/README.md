# Unc eval harness (Phase 7)

Golden-fixture regression tests for the deterministic brain. `npm test` runs them with the
runtime suite (`vitest run`; config in `vitest.config.ts`, which also maps the `@/` alias and
keeps Playwright's `tests/e2e/**` out of vitest).

| File | Protects | Tests |
|---|---|---|
| `src/lib/platform/__tests__/goal.test.ts` | Goal math — pace / needed / lands-at, the status pill, the target parser, money formatting. Locks the demo: **"Behind by NZ$3,218"**. | 19 golden rows + guards |
| `src/lib/platform/__tests__/plan.test.ts` | Plan generator — channel scores (posture × strength × budget gate), phase order, week split (30/30/40, minimums, 4-week clamp), the exact phase titles and week spans `derive()` renders. | 16 founder profiles × 2 + splits |
| `src/lib/unc/__tests__/narrative-guardrails.test.ts` | The code-enforced guardrails on Sonnet's plan prose: numbers only from input, one note per phase, footnote prefix, span-prefix stripping, channel naming. | crafted LLM-like outputs |
| `src/lib/unc/__tests__/scan-guard.test.ts` | The SSRF guard as pure functions (`checkUrlSyntax`, `isPrivateAddress`) plus `isSafeUrl` with the DNS resolver module-mocked. No network. | 35 rejects, 7 accepts, 37 ranges, 7 DNS |
| `src/lib/unc/__tests__/context.test.ts` | `buildUncContext` — list caps (10; `routines.active` 40), pure data only, a golden key list so the context cannot grow silently. | 13 |

Every expected value is inline. Fixtures are meant to be read as documentation of what the
brain does with a given founder — including the surprising cases (a sales-led founder whose
strengths are Writing + Paid media gets Content first; a paid-led founder with Paid media
strength stays on paid even under the NZ$50/day gate because 1.5 > 1.44).

## The "no invented numbers" contract

Testable statement (locked in `narrative-guardrails.test.ts › CONTRACT`):

> For any model output `raw` and request `req`, every number literal in every field of
> `parseNarrative(raw, req).narrative` is a member of `allowedNumbers(req)` — i.e. it appears
> verbatim in the goal, resources or plan JSON (commas normalised), in the attached business
> profile, or is a count from 1 to 12.

Corollaries the tests pin down:

- A number the *app itself* shows but the request does not carry (NZ$3,218 behind, NZ$171/day)
  is still rejected — the request is the contract, not the screen.
- Decimals not present in the input are rejected (`1.5x`).
- Phase notes are all-or-nothing: one bad note discards all three live notes.
- The fallback for every field is the deterministic copy, whose numbers are in the request
  by construction, so the contract holds for the fallback path too.

`buildUncContext` is the chat-side half of the same rule: it is the only source of numbers Unc
may quote in replies, so its key set is golden-locked and it must serialise as pure data.

## Adding a fixture

1. **Goal:** add a row to `GOLDEN` in `goal.test.ts`. Compute the expected values from the
   formulas in the file header (elapsed is always 19 days on the demo clock; days left is
   `max(1, round((deadline − 2026-08-31) / 1 day))`). Name the row for the *behaviour* it locks.
2. **Plan:** add a `FounderFixture` to `FOUNDERS` in `plan.test.ts` with posture, strengths,
   budget, deadline, the best-first ranking with scores to 3 dp, and the three `[span, title]`
   pairs exactly as the home plan renders them. Both the pure scorer and `derive()` are checked
   against the same fixture.
3. **Narrative:** craft the model output as a `PlanNarrative` literal (start from `GOOD`), state
   which rule it should trip, and assert the field-level fallback plus `liveFields`.
4. **Scan:** add the raw URL and the exact reason string to the reject/accept tables, or the IP
   to `priv`/`pub`. For DNS behaviour use `mockLookup.mockResolvedValue([...])` — never resolve.
5. **Context:** if you intentionally add a field to `buildUncContext`, update `GOLDEN_KEYS` in
   the same commit and say why in the message; that is the review hook.

Known bugs are locked with `it(...)`: the assertion states the *correct* behaviour and the
test is expected to fail. When the code is fixed the test errors with "expected to fail" — drop
the `.fails` and delete the paired "documents the actual behaviour" test.

## Real bugs found (all locked as `it.fails`)

| # | Where | Expected | Actual |
|---|---|---|---|
| 1 | `src/lib/platform/goal.ts:52–53` — target parser `/\d[\d,]*/` | `"$1.2M revenue"` → 1,200,000 | reads **1**, floored to current + 1 → founder shown **On track, 100%**. Inherited verbatim from `design-reference/platform-v2-logic.js:121–122`. |
| 2 | `src/lib/platform/goal.ts:52–53` — same parser, k-suffix | `"25k engaged followers"` (the demo's own `goalTexts.brand`) → 25,000 | reads **25**, floored to current + 1. Every non-revenue demo goal text (`63% blended margin`, `40 qualified leads/mo`, `22% repeat purchase rate`) collapses the same way under the demo MRR. |
| 3 | `src/lib/platform/goal.ts:56–62` — deadline parse | an unparseable deadline yields finite numbers | `Math.max(1, NaN)` is NaN → `needed`/`proj`/`gap` NaN → pill reads **"Behind by NZ$NaN"**. Hard to reach through the date input today; the divide-by-zero guard does not cover it. |
| 4 | `src/lib/unc/narrative.ts:286–288` — channel-name check | a phase-3 note saying "SEO and paid ads switch on…" is accepted | channel token is built with `channel.toLowerCase().split(/\s\|&/)[0]`; for the comma-joined phase-3 channel `"SEO, Paid ads, Sales"` that is **`"seo,"`** (comma attached), so any note not containing the literal `seo,` is rejected — and because notes are all-or-nothing, all three live notes are thrown away. |
| 5 | `src/lib/unc/scan.ts:95` — v4-mapped IPv6 (low severity) | `::ffff:7f00:1` (= 127.0.0.1 in hex form) is private | only the dotted form `::ffff:a.b.c.d` is recognised. Not reachable through `isSafeUrl` today because Node's `dns.lookup` formats mapped addresses in dotted form; a gap in the pure function, not a live hole. |

Non-bug observations locked as documentation:

- `baselineNum: 0` is falsy and silently becomes the demo baseline 28,400 (`||`).
- The goal clock (today = 31 Aug) and the plan-week anchor (1 Sep) are two different demo clocks.
- The paid gate is `round(budget/30) ≥ 50`, so NZ$1,485/mo passes (49.5 rounds up) and NZ$1,484 does not; it is a ×0.3 multiplier, never a hard exclusion.
- "Zero days elapsed" cannot be exercised: `DEMO_TODAY`/`DEMO_START` are constants, so elapsed is 19 for every input. A test asserts that constancy so the day the clock becomes real, the missing fixtures are flagged.

## Not unit-tested here

- `scanBusiness` / `safeFetchPage` / `htmlToText` — the fetch + redirect-hop loop and the Sonnet
  profile call. The guard they depend on is fully covered; the loop itself needs a fake `fetch`
  and belongs in an integration suite.
- The live `/api/unc/*` routes and `useUncChat` — they call the model.
- The React surfaces — Playwright (`tests/e2e/**`) owns those.
