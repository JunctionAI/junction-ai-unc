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

Full local suite: **216 files / 2,839 tests pass**, including a fresh full rerun at
05:11 NZ. App/worker TypeScript and focused lint pass. Fresh continuation also
reran 24 directly affected tests and the offline delivery review.

## Matched release and independent production checks

- Source **`1e72947d12a5a80ada88a3b5e24af92183743e54`** pushed to
  `codex/backend-foundation-20260905`; independent remote ref matches.
- Clean isolated worktree `/private/tmp/unc-output-validation-release.i5d5i9`;
  unrelated untracked `src/lib/runtime/context 2.ts` is not included. No secret
  environment files copied. The app upload excludes review documentation.
- Vercel **`dpl_BcR3ws4fPoDSg5Krx4RVDGyvT2QL`**, Next **16.3.4**,
  build **38 seconds**, READY. Candidate:
  https://junction-mzz4ci443-tom-junctionmedis-projects.vercel.app .
  Candidate health reports matching SHA and healthy DB; anonymous artifacts GET
  returns 401. Promoted only after these checks; canonical
  https://junction-unc.vercel.app/app now serves this release.
- Fly **release 32**, sole Sydney machine **`1857466fd76998`**, image
  **`sha256:02f11916e5a29f45a82956f77829f2ecac63412fb8dfcde90962d209bcf0a8c9`**,
  tag `deployment-01M1S8XN9HPJB69P2V13XQS66A`. Remote compilation, alias check,
  rolling smoke and health checks pass; machine started.
- At **17:14:29.255Z**, `scripts/verify-artifact-validator-worker.cjs` ran inside
  the actual worker with the expected full source SHA. Both its compiled shared
  validator and bridge parser reject nine missing/unsupported kinds and accept
  three synthetic valid kinds. Zero database/provider/n8n calls or writes.
  This proves deployed validation, not real business-output quality. Named
  uncertain-execution recovery remains unit-tested, not a newly induced live
  provider failure.
- Actual worker environment confirms all five command/action flags false, sync
  and reader allowlists absent/off, command release scopes absent/deny-all.
  Separately, authenticated reads of Vercel production project flags confirm
  commands/messaging/live false, with update times predating this deployment;
  SMS/Apple/sync/reader/scopes absent. These are project settings, not direct
  application-runtime environment introspection. The deployment only overrides
  its nonsecret build SHA; no action flag changes were made.
- Canonical health at **17:15:20.894Z**: SHA `1e72947d12a5`, DB healthy, worker
  fresh at 15 seconds, two ticks, no last error. Anonymous keyword configuration
  and workspace history return 401 with private/no-store; artifacts returns 401
  with public/max-age=0/must-revalidate, containing only the sign-in error.
- Independent SQL at **17:15:19.971965Z**: AVGAR generation 1, paused, zero enabled
  routines, four runs, one command, four snapshots — unchanged from pre-release.
- Bounded new-deployment error/fatal scan from 17:12:36Z through approximately
  17:15:25Z returns no entries. Drains read at **17:15:31.463Z** returns zero.
  Independent alert delivery and ongoing monitoring remain open; a short clean
  log window is not their acceptance.

Rollback targets remain prior app `dpl_qwBs38btjfsjNhEM5m1fmkgmJUzX` at
`bb538e2e3638`, and worker release 31/image
`sha256:0d1203fa6c2bd9d1c94f4357cb8fee80f29f72c1acd00a7a4136986ed1507692`.
Worker rollback retains the dataset completion fence but loses these output
validation/recovery fixes. Keep action/sync holds unchanged during any rollback.

Unc remains pinned to `92135add-3c35-43e4-9649-5bb3d4557814`. Historical runs and
artifacts are untouched. AVGAR stays paused, all routines and external actions off.
The full B01–B24 and all-client launch acceptance remain open.
