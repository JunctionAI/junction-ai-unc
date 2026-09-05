# Command delivery identity — verified source, not live

5 September 2026, approximately 07:22 UTC. Continues B03/B16/B19/B20; B01–B24 remains the full active goal.

## Result

- Verified channel ingress carries its original destination, connection revision and Slack workspace into the durable command. Nested identity is copied/frozen before asynchronous interpretation and execution.
- New non-app commands require a matching captured binding. Existing commands are not backfilled from today's connection. Queue decoding preserves the captured link even if the live-link foreign key later becomes null.
- Owner checks now validate the full original channel binding, not just a current matching user/channel on the same link ID. Same provider message IDs on different connection revisions have different command identities. Existing app message-ID behavior is unchanged.
- A database-owned notification revision advances only when status or reply changes. Repeated reconciliation of the same result does not create another notification. Waiting and final results no longer collide under a single command send reference.
- prepare_command_notification atomically checks the original owner/binding and requested result revision and reserves an outbox operation using the stored reply. A caller's stale or replaced polling reply cannot become the sent content.
- At the outbox send claim, a source guard checks the command's current result revision, exact binding/content and current owner. A superseded queued message becomes cancelled with no attempt and no provider call. WhatsApp resumption therefore cannot emit an older waiting message after the command has moved on.
- The outbox is the delivery authority for captured commands. Queued/uncertain are not marked sent in the legacy notification_status column. There is no command-row update after provider I/O that could erase or misattribute an original receipt after reset.
- Notification polling excludes invalid bindings and non-retryable outbox states before limiting results. Queued work remains eligible and notification_checked_at rotates repeated checks so a closed WhatsApp window does not permanently monopolize the oldest candidates.
- Connection deletion can clear only the mutable live-link foreign key on a captured command, including after a pause/reset. The original immutable binding and delivery receipts remain.

## Database and compatibility

New staged migration: 20260905071413_command_delivery_identity.sql. Depends on all four previously staged channel identity/control/chat/outbox migrations.

The **unreleased** outbox migration was amended so its claim result is derived from the stored post-trigger status. This matters because the new source guard can cancel a superseded operation during the UPDATE: returning claimed=true unconditionally would have been unsafe. This is a source migration change, not a mutation of applied migration history; independent readback confirms neither migration is installed.

Only routine_commands replaces its old blanket pause trigger on INSERT/UPDATE with the explicit existing context guard plus new immutable delivery guard. The existing DELETE pause hold remains. A narrowly checked FK-only nulling transition preserves historical identities without authorizing other stale writes. RPCs are invoker-rights and service-only, following the Supabase [function privilege guidance](https://supabase.com/docs/guides/database/functions#function-privileges).

Do not deploy against the old schema or restore the legacy worker notification logic after this schema is installed. The old notifier's claimed/sent column is no longer authoritative for captured commands.

## Verification

- **191 files / 2,320 tests pass**, including 10 new command-delivery tests and expanded ownership tests.
- Application and standalone worker TypeScript pass; production webpack build passes; diff checks pass.
- Lint: zero errors / 39 pre-existing warnings.
- All three real PostgreSQL canaries passed together inside one rollback transaction: the outbox canary, the existing command-context regression canary (updated to supply a real captured Apple binding), and the new command-delivery canary.
- SQL exercised idempotent preparation, single claim, waiting→done supersession, owner demotion at claim, source identity/content, no queued/uncertain false success, current-only notification polling, immutable revisions, and reset/unlink preservation. Actual authenticated RPC access was denied; no definer privilege was introduced.
- **07:21:00 UTC independent readback:** zero command/outbox canary accounts, zero staged delivery columns, zero commands/outbound rows, AVGAR generation 1 / revision 15 / paused.
- Live security advisors remain **six WARN/eight INFO**, not a clean security sign-off. Outstanding remediation remains [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Logs: /tmp/unc-command-delivery-full-tests.log, /tmp/unc-command-delivery-lint.log, /tmp/unc-command-delivery-build.log. New reproducible SQL: scripts/verify-command-delivery.sql.

No persistent DDL, app/worker deployment, provider/model request, live message, workflow edit/execution, API key or plan purchase occurred.

## Next work / honest boundaries

The command path is now covered in source and rollback tests; it is not production phone acceptance. A request already in flight cannot be recalled by a later revocation. Simultaneous multi-session PostgreSQL/load and real provider reconciliation remain release evidence.

The next concrete work is artifact delivery. Inspection confirms three linked gaps: the route makes a fresh timestamp send reference, retries reselect today's destinations, and DraftCard labels queued as sent. Artifact views/listing also lack a captured account/generation envelope and can display archived run material. Fix the full chain: current-generation listing/decision/send binding, stable browser operation, a durable first-acceptance destination set, unchanged content/source verification, and honest queued/uncertain UI. Do not fix only the timestamp or only the wording and call delivery safe.

Then finish OAuth-init→callback identity, unlinked help-message journaling, queued non-command proposal expiry, remaining delayed/runless writers, exact preservation of current AVGAR chat rows, coordinated release and real phone/web/second-client acceptance.

n8n's receiver reconciliation, execution-reader access, account/revision registration and bounded paid-admission gates remain open. Nguyen's frozen workflow has not been modified. Publishing, messaging, ad and spend activation remain disabled.
