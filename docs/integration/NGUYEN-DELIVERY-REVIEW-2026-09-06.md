# Nguyen delivery review and Unc output validation — Batch 54

6 September NZ / 5 September UTC. Partial acceptance only; no new workflow pin,
provider invocation, customer send or ad change follows from this review.

## Delivered evidence

Downloaded `tom-2026-09-05.zip` from Nguyen's actual Upwork attachment. Archive
SHA-256: `2c6c055760516863c6fca65eb362e827f22016b9879b24579e666008a55b1ceb`.
Ten files, 56,166 uncompressed bytes. Review copies are under
`deliveries/nguyen-2026-09-06/`; the JavaScript is stored as inert `.js.txt`.
Copies normalize BOM/newlines; the original ZIP remains in Downloads. Pattern
inspection found no common secret signatures, not a comprehensive secret audit.

Independent authenticated n8n GETs at **2026-09-05T17:03:08.845Z** read the
published workflow and saved executions #77–79. Published/draft revision:
`e5ae41ae-d025-4231-9f5c-99589c43e88a`. Definition SHA-256:
`fac94aaa603e5497004428213c2b665d95919aa6779b6007836526ce299d5301`.
The delivered builder's normalized hash matches the published node exactly:
`c20f01dbe355c5ac16cc917526f3c3ae1bbddbbba5ba4e5d5e843d166368b513`.
`independent-provider-inputs.json` retains only allowlisted run/provider fields,
not authorization headers or data tokens. Four read-only n8n calls; no executions.

## Reproduced findings

`node scripts/review-nguyen-keyword-output.mjs` replays the inspected, hash-pinned
builder offline against those independently read provider inputs and the compiled
Unc validator. The VM is a test convenience, not a sandbox for arbitrary code.

- US/NZ/AU historical statistics reproduce, including organic difficulty 3/0/0,
  pending prioritization and unverified/null targets. This is saved evidence,
  not a new market observation or current live E2E acceptance.
- Exact delivered fixture output differs at `prioritization_reason` and a
  receipt `correction_prep` field. Statistics agree; fixtures are not exact
  unannotated builder exports.
- Zero SERP result count, a generic search check URL and an unrelated SERP item
  each incorrectly produce a matched target with no actual target URL and a
  scored priority. Blank difficulty becomes zero; malformed difficulty becomes
  NaN and still produces a score. All five boundary cases reproduce the defects.
- Each keyword provider evidence entry lacks the required `ref`, so the existing
  evidence normalizer drops it (one entry becomes zero). Other provider facts
  remain in item metadata/receipt; this is not total loss of all provenance.
- Both email examples declare `email_draft`, and the calendar declares
  `campaign_calendar`, rather than contract kinds `email` / `calendar`.
- Email customer bodies contain internal flow names, sample counts, metrics,
  draft instructions and TBD slots. Aggregate shipment counts do not prove that
  an individual customer's order is on the way. Approved education copy remains
  missing; do not label the incomplete recipient content complete.
- The calendar does contain six forward weekly entries. Inventory is useful,
  but some rows marked packaged-ready have no corresponding delivered example;
  revision IDs are abbreviated. D03-W07 is already reserved for backlink gap.

At **5:05 AM NZ**, the specific correction request was sent and read back in
Upwork. Requested output-only corrections, exact offline fixtures, clean recipient
copy with separate notes, actual missing examples or truthful delivery status,
full revision IDs and a concrete ETA within the existing agreement. Nguyen should
validate first and publish once, then provide the frozen revision/export. No new
provider calls, credentials, wrapper redesign or additional charges authorized.
Codex owns later-lane callable adapters; these are not reassigned to Nguyen.

## Codex fixes

The shared artifact validator previously silently relabelled unknown/missing kinds
as the requested kind. It now rejects them. Nine malformed-kind cases cover the
regression. Recognized but mismatched kinds remain rejected as before.

The n8n bridge now validates and retains a reported execution ID before rejecting
a malformed business artifact. The permit becomes uncertain with that execution
reference, not accepted/refunded/replayed. A foreign-account receipt is not
retained. Two bridge tests prove no artifact acceptance, no independent-verifier
claim and no repeated fake provider call. Reported identity is not independent
execution verification; invalid output still requires reconciliation.

Full local suite: **216 files / 2,839 tests pass**. App/worker TypeScript and focused
lint pass. Fresh continuation reran 24 directly affected tests and the offline
delivery review. Cloud production build and matched app/worker release are next;
source fixes alone do not establish production behavior.

Unc remains pinned to `92135add-3c35-43e4-9649-5bb3d4557814`. Historical runs and
artifacts are untouched. AVGAR stays paused, all routines and external actions off.
The full B01–B24 and all-client launch acceptance remain open.
