# Calendar durable integration — Batch 62

6 September 2026 NZ. **Backend implementation; no live customer calendar claim.**

## Implemented

- Dedicated server-only binding and run tables, immutable owner allowance and
  account/generation/run-scoped transitions. Credentials remain native references,
  not copied keys. Token/request fingerprints do not disclose bearer tokens.
- Separate `unc_calendar_private` schema. The existing `unc_private` schema was
  not accessible to service_role; its privileges were not broadened. All seven
  new functions are security-invoker with empty search_path and explicit grants.
- Atomic issuance/start/dispatch/authority and one-way consumed states. Neither
  uncertainty nor expiration restores an allowance. Duplicate issuance returns
  original IDs and does not silently restart the engine.
- Candidate checkpoint, independently verified result, single transaction for
  one draft/three correlated receipts/run completion, and original-result readback
  after lost completion responses. Recovery reads only the named saved execution;
  it preserves original source time and verifies both request and result hashes.
- Worker factory wiring, separate POST-only authority route and explicit operator
  `runCalendarShadow` selection of an accepted binding. No generic chat/scheduler
  permission is inferred. Missing reader/receiver pins refuse before issuance.

## Verification

`npx tsc -p tsconfig.calendar-sql.json` followed by
`node scripts/verify-calendar-shadow-ledger.mjs /tmp/unc-manual-pg.x8Y6jR`
runs the exact migration on an isolated real PostgreSQL cluster. The small SQL
transport invokes actual production adapters; it does not mock SQL semantics.
The full engine → admission → authority → bridge → saved-output projection →
atomic completion path passes with exactly one **synthetic** POST and GET, zero
real provider/remote database calls. A recreated recovery/completion adapter also
finishes the original result after a simulated day without another dispatch.

Real concurrent connections test one-winner issue/start/dispatch/authority and
completion, failed receipt-insert rollback, role/tenant/asset/key/expiry boundaries,
immutable evidence, and stored data. Eighteen observed lock-wait cases cover
pause, generation, owner, switch, registration and expiry at start/dispatch/auth.
An additional observed connector lock reproduced acceptance of a snapshot that
expired while waiting; freshness now rechecks after that lock and the test passes.
The initial SQL variable ambiguity was also caught and corrected before migration.

At 07:10 NZ: **226 files / 3,014 tests pass**; app TypeScript, standalone-worker
TypeScript, production Next 16.3.4 build, focused ESLint and diff checks pass.
The schema inventory test now accounts for the two new tables.

## Production database

Migration `20260905185010_calendar_shadow_ledger.sql` applied successfully at
approximately 07:11 NZ. Independent function-body MD5s match all seven local
bodies; public/authenticated cannot execute any new function. Both new tables
have RLS enabled, no browser-role access, service read/insert/update and no delete.
No binding, registration, allowance, customer run or provider call was created.

Security advisors retain six existing WARN findings. The only additions are two
INFO [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
for the intentionally server-only tables (19 INFO total). No browser policies or
existing-role grants were added to suppress them. The prior warning inventory
and broader B20 security work remain open.

**App/worker release is pending at this report's initial commit.** See the release
addendum before treating the authority route or factory wiring as deployed.

## Handoff and remaining gates

At 07:11 NZ, a fresh Upwork read found Nguyen's 05:37 corrected handoff:
revision `ac771cd3-8899-4401-915c-40d4477e48e2`, attachment
`tom-2026-09-06-final.zip` (21 entries, 84,889 uncompressed bytes), downloaded to
Tom's Downloads. ZIP SHA-256:
`214c41dacbc4c0faf82a25a5bd99c8208072c2b31cc3f757873f235d3017e1ab`.
This is received, **not yet independently accepted or repinned**. No duplicate
complaint or new run authorization was sent. Review exact builder/export/fixtures,
email/calendar examples and inventory next; do not modify his working workflows.

Next: accept the handoff, verify the intended native Klaviyo credential/account
binding, package the callable calendar receiver, configure its separate pins,
finish customer selection/recovery, and run an explicitly bounded shadow window.
AVGAR stays paused, zero enabled routines; publishing/messages/ad changes/spend
activation remain off. No fresh provider window has been opened.

Retention is explicit unfinished work: restrictive FKs preserve original evidence;
B21 needs the governed archive/purge sequence before real calendar bindings are
retired or their account is deleted. This does not claim full retention support.
The complete B01–B24/all-client/launch goal remains active and incomplete.
