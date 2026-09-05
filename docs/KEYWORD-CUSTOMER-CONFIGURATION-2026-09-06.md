# Customer keyword configuration — 6 September 2026

Status: source implemented and database function installed; app/worker release and signed-in customer execution remain outstanding. This does not close the full backend or launch goal.

## Customer behavior

The keyword routine gets a simple US/NZ/AU market selector instead of the general-purpose recipe editor. Seed is the approved `golf travel bag`, domain `avgarsport.com`, language English. No country is silently chosen. Saving a market does not enable the routine, create a run, grant provider authority, register a workflow, or change credentials. Setup can be saved while the account is paused.

`GET/POST /api/routines/keyword-configuration` requires a verified owner session plus the exact captured account/generation headers. The browser submits only market and original settings version/timestamp. The server retrieves and validates the canonical recipe; the browser never supplies a recipe or credential selector. Responses expose business settings and release status, not internal recipes/webhooks.

The database selects from completed, current-generation pilot runs joined to verified permits and correlated independently verified artifact receipts at frozen revision `92135add-3c35-43e4-9649-5bb3d4557814`. Completed runs clear resumable snapshots, so retained permit recipes supply the definition and matching run hashes retain correlation. Missing or contradictory evidence is not eligible. Source outputs remain untouched; their pending business-quality corrections are a separate gate.

Saving serializes on the account, rechecks owner/generation/current registration, requires the original settings timestamp/version, and rejects an enabled routine, pending draft, unresolved command or provider attempt. The exact server-selected recipe must equal the stored candidate. Two simultaneous saves have one winner. Losing the save response clears actionable UI and requires a read; no automatic POST retry. Account/generation/actor changes discard late UI replies.

## Verification

- Full unit suite: 213 files / 2,723 tests pass, including 16 new configuration tests.
- App and worker TypeScript pass. Focused lint has no errors; RoutineDetail retains its existing image warning. Diff whitespace check passes.
- `node scripts/verify-keyword-configuration.mjs /tmp/unc-manual-pg.x8Y6jR`: 18 checks pass against real isolated PostgreSQL, including an observed concurrent lock wait and one save winner. Dependency schema/evidence are synthetic, not a full production clone. Zero provider calls.
- Six isolated Chromium UI checks pass: save/reload, lost-save read recovery, context change during save, enabled/draft denials, 390px and 1280px layout. Page loads with no JS errors or framework overlay. Fixtures contain synthetic data and no environment secrets.
- Source migration `20260905153025_keyword_customer_configuration.sql` applied to `ycgayfsvcjpsnryrpukv` as **20260905154039**. Independent function-body MD5: `739c5f8f18a3868a276e6304136696ef`; security invoker, empty search path, service-role-only execute, no anon/authenticated execute.
- Live function read resolves exactly US run `39ed122b-5b29-4e7d-9fae-0d974a8962e9`, NZ `14c8823c-2a45-427d-8286-7ec44af3988a`, AU `b68396e5-d925-4f9c-8038-84e5f87ca9aa`.
- Production rollback-only save passes against actual constraints, stale-save and wrong-owner denials pass; rollback independently leaves version 1, no live recipe, routine off, generation 1, account paused, zero commands and three runs.
- Security advisors remain 16 INFO / 6 WARN. Existing vector/public, membership/invite definer exposure and leaked-password-protection warnings are not resolved or bypassed by this change.

## Next required work

1. Finish the customer keyword request control against the existing command queue and original-request recovery; do not send keyword requests through generic manual admission.
2. Release a tested matching app/worker pair containing B45–B47, retaining disabled command scopes until supervised acceptance. The new market UI is not live yet.
3. Save the reviewed initial market, configure exact short-lived account/recipe release scope, and prove the signed-in request → one provider attempt → verified reloadable result → switch-off refusal. Restore the setup hold after supervised acceptance.
4. Continue the original B01–B24/all-client register, later lane adapters and Nguyen output QA. No other lane or external action is authorized by this configuration.
