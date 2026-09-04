# Conversation → governed routine execution

Status: local implementation, opt-in and draft-only. Not deployed or exercised against
AVGAR/n8n Cloud. `UNC_COMMANDS_ENABLED` is OFF unless exactly `true` in both app and worker.

## Implemented path

1. App chat supplies a per-message UUID. The server resolves the authenticated owner; any
   account/permission hints in browser context are ignored for dispatch.
2. Slack/SMS verify the provider signature, then persist normalized events to `channel_inbox`
   **before** HTTP acknowledgement. Storage failure returns 503, never a false success.
3. The worker consumes the inbox. A verified channel link supplies the account and user;
   Slack workspace must also match. Existing explicit approval handling remains separate.
4. `routeCommand` is shared by app and channel messages. A classifier can return only chat,
   clarification, or one known routine ID. An exact `/run D01-W01` bypasses the classifier
   for deterministic testing. Free-form requests currently use the account's `chat` model and
   its existing spend-reservation rail. No new model or model installation is required.
5. Owner role, enabled state, supported required reads, connected platforms, business fit
   and uncached model budget are checked before queueing, then checked again at execution.
6. The durable command stores the effective spec hash/version and selected implementation
   fingerprint. Changes while queued block the command. Execution uses that validated spec
   and frozen workflow selection, not a later global fallback. A failed selected n8n
   implementation cannot silently fall back to a built-in model producer.
7. The existing runtime, account source and connector provider run in `dry_run` mode with a
   deterministic persisted run ID. Credentials, platform IDs and queries are not model output.
8. Artifacts, reads and receipts use the existing runtime stores. Callback completion is
   reconciled without executing the job again. Status text is derived from stored run state.
9. App chat polls its owner-only status endpoint for up to six minutes; account changes and
   unmounts cancel polling. Channel progress/results go only to the originating verified link.

## Contracts and deliberate limits

- A command starts **one routine with its saved inputs/settings**. Arbitrary custom date
  windows, targets, multistep plans, switch changes, ambiguous followups, approvals and live
  actions are not model-executable. The classifier must clarify these requests. Its 0.95
  threshold is a conservative parser gate, not a measured accuracy claim.
- Disabling stops new dispatch; it is not cancellation or rollback of an in-flight run.
  Scheduled execution now rechecks the enabled flag after due-candidate collection.
- Interactive owner-triggered `/api/routines/run` remains the legacy synchronous dry-run
  testing endpoint; ordinary chat uses the new durable queue. Scheduled jobs retain their
  existing scheduler. This is not a wholesale scheduler replacement.
- Queue compare-and-set grants one claim. A crash after claim is **uncertain**, not a reason
  to replay provider calls. Saved terminal runs are reconciled. Stranded claims after ten
  minutes are surfaced as uncertain. Investigate receipts before issuing a new message ID.
- Failed/ambiguous channel delivery is also not blindly resent. A notification claim is
  recorded before sending. `notification_status=claimed/failed` needs operator reconciliation.
  This is at-most-once automatic dispatch with explicit uncertain outcomes, not an exactly-once
  guarantee across databases and external providers.
- The workflow fingerprint pins Unc's registration (ID, scope, URL, active flag), **not** the
  contents behind a mutable n8n URL. Production handoff must provide a versioned immutable
  endpoint or a verifiable workflow revision contract. That still needs the developer's input.
- The Unc model budget does not meter model calls billed directly inside external n8n flows.
  Those flows need a verified budget/proxy agreement before being offered broadly.
- Slack/SMS have the durable ingress path in this release. Telegram/WhatsApp retain their
  existing ingress; they can dispatch commands after receipt, but do not yet have the same
  save-before-acknowledge guarantee. Slack replies currently use the owner's DM, not arbitrary
  shared-channel posting. Cross-channel team conversation permissions need separate design.
- Queue records contain customer request text; no raw platform credentials are stored. Both
  tables are RLS-enabled and entirely unavailable to `anon`/`authenticated`. Server APIs scope
  command reads to the current owner and account. Production retention/cleanup and queue health
  alerting must be configured before a broad rollout.
- Raw metadata and errors are not model evidence. A connected checkbox is not live input proof;
  existing reader provenance/freshness checks still apply. Optional inputs may produce a labelled
  hypothesis or missing-input request, not a claim of measured provider output.

## Rollout gate — requires a separate release decision

1. Review the diff and apply `20260904011301_routine_command_queue.sql` to the intended
   project only after permission. It adds two tables; it does not alter credentials or grants
   on existing tables. Verify grants/RLS against real project roles.
2. Deploy matching app and worker builds with commands still OFF. Confirm database, credential
   keyring, model budget, worker health, correct account memberships, and provider identities.
3. Configure customer-owned connections, required provider permissions/app approvals, and
   developer-provided workflow mapping/output contracts. Do not copy credentials into workflows.
4. Enable the command flag for the controlled beta environment in both app and worker. Since
   inbox ownership changes when enabled, keep both flags aligned and reconcile/drain pending
   inbox rows before disabling. Turning the flag off does not cancel in-flight work.
5. Test two isolated accounts with explicit `/run` first. Inspect source/artifact/receipt data.
   Repeat via Slack and SMS; prove duplicate delivery, wrong workspace, revoked owner, disabled
   switch, missing connection, exhausted budget, changed workflow, timeout and callback handling.
6. Run a live classifier evaluation with real founder wording and adversarial/ambiguous cases.
   No claim of free-form routing accuracy until those results are recorded.
7. Test useful AVGAR SEO and Meta artifacts with the developer's real shadow workflows. Keep
   `LIVE_MODE_ENABLED=false`. This change never authorizes send, publish, pricing or ad spend.

## Local verification

`npm test`, app and worker TypeScript checks, production compile, lint, and the standalone
worker module import check cover the implementation. New tests include duplicate/concurrent
dispatch, two-account execution, source pinning, no fallback, and durable inbox failure handling.

`scripts/verify-command-schema.mjs` uses an optional temporary PGlite installation for a real
PostgreSQL engine smoke test of the new migration against minimal referenced tables. It verifies
schema validity, role grants, RLS enabled, compare-and-set claims, enums and uniqueness. It does
**not** replace testing all deployed migrations or the target Supabase project's roles.

Primary references consulted: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
the installed Next.js 16 route-handler documentation, and existing n8n integration contracts.

### Verification receipt — 2026-09-04, local checkout

- Unit/integration suite: PASS, 162 files / 1,928 tests (46 new command/inbox tests).
- App TypeScript: PASS.
- Standalone worker TypeScript and compiled module import: PASS; no runtime `@/` aliases.
- Production webpack build: PASS, 18/18 static pages, including the new dynamic command API.
- Lint: PASS, 0 errors; the 39 existing source warnings remain. Generated worker output is
  now excluded from lint, as other compiler output already was.
- Browser: 11/11 selected Chromium tests PASS (9 existing control-centre checks + 2 new
  command progress/blocker checks). Command/backend responses in these browser tests are
  fixtures, not live provider execution. Sandbox port binding failed first; the approved
  local-port rerun passed.
- New queue schema: PASS on temporary PGlite 0.5.8 (real local PostgreSQL engine, minimal
  referenced tables). Target-project migration/RLS validation remains pending.
- No production deployment, migration application, credentials change, external workflow
  execution, git push, or live-mode enablement performed.
