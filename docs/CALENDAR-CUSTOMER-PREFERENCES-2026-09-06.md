# Calendar customer setup — Batch 71

6 September NZ / 5 September UTC. Owner timezone setup, not calendar execution
acceptance or full B01–B24 completion.

## Implemented

Calendar routine detail now includes a timezone input with common NZ, AU, US and
UTC suggestions. No timezone is silently selected. GET/POST use the verified
owner session plus captured account/generation/actor; browser input contains
only the timezone and original saved timestamp, never credentials or recipes.
Saving changes no switch, registration, allowance, workflow or provider account.

The private `unc_calendar_private.customer_preferences` table stores explicit
calendar preferences per account/generation and the last owner's identity/time.
This is separate from learned briefing cadence and provider reporting timezone.
It has RLS and no browser-role table privileges. The security-invoker RPC requires
current ownership, valid timezone, account-first locking and timestamp comparison.
Existing bindings, outstanding calendar runs/commands and enabled/draft calendar
settings prevent edits. New binding inserts must match the selected timezone.
Historical bindings are not rewritten; existing admission/receipt rules remain.

The client handles failure by reading saved state, never replaying a save. Late
responses from another account generation cannot update the new screen. Timeouts
release the spinner and require refresh. An accepted binding is not labelled
as an operational workflow or proof of a generated customer calendar.

## Verification

- 228 application test files / **3,069 tests** pass; the 19 new route/client cases
  cover identity, strict input/output, timestamps, lost responses and safe errors.
- Six real-browser synthetic fixture tests pass: save/reload, lost-save readback,
  late response after context change, locked/invalid settings, 390px and 1280px.
  No provider or production data is used by these browser fixtures.
- The full existing real-PostgreSQL calendar harness applies the new migration
  alongside the exact ledger migrations. It proves concurrent one-winner save,
  no implicit timezone, role/context/invalid-timezone denial, pending-work locks,
  absent/mismatched preference binding refusal, and the existing complete engine
  → SQL → synthetic provider → verified saved-result → atomic artifact/receipt path.
  All nine calendar functions remain invoker with empty search paths.
- App/worker TypeScript and production build pass after fixing a typing-only
  test-data union. Focused lint: zero errors; existing RoutineDetail image warning.

## Production database evidence

`20260905213903_calendar_customer_preferences.sql` applied through migration
history. Independent readback at **21:45:46.153388 UTC** matches both function
bodies: `calendar_customer_preferences` MD5
`fb1629e47c964fa5c9915203954bfe44`, preference-binding guard MD5
`d505b72e910ff2c628f33dde3164d2ae`. Both are security-invoker with empty search_path;
anonymous/authenticated direct calls are denied. Table RLS is enabled and browser
access denied. The existing service role has the intended table/RPC permissions.

Real AVGAR read returns paused generation 1, timezone null, no binding and settings
editable. **Zero preferences were seeded.** No binding/run was created. Owner
timezone choice remains pending; provider USD/US-Eastern and Unc NZD are unchanged.

Security advisors: six pre-existing WARN notices unchanged; INFO count 19 → 20
because the new server-only private table deliberately has no browser policy.
[RLS-without-policy explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Do not add browser policies merely to remove that informational notice.

## Release and remaining journey

Source/database/browser-fixture checks pass; app/worker rollout and signed-in
production readback follow this source checkpoint. No live customer save or
calendar result is claimed by the tests above. Calendar receiver publication,
accepted account binding, bounded execution, client result/recovery and useful
output acceptance remain Codex-owned. Other lanes/clients, sync, channels,
monitoring, costs, security and retention remain in the original active goal.
No Nguyen workflow or outward-action permission was changed.
