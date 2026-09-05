# Junction-owned client agents: migration decision

6 September 2026. Status: implementation in progress, not connected-client acceptance.

## Owner direction

Keep the clients' existing communication channels, but replace the execution
dependency on Hyperagent with Junction's own governed runtime. Hyperagent is an
inventory/history source, not the authority for client access or routine choice.
Do not copy its autonomy settings or treat attached writer tools as permission.

## Target request path

1. A signed Slack event identifies the workspace, channel, sender and thread.
2. A registered workspace/channel route selects exactly one client. Independently
   verified sender membership decides whether that person may request the work.
   A shared Slack user must not move a connection between clients on reinstall.
3. Junction interprets the request against that client's enabled routine IDs.
   The model may propose a routine; the dispatcher validates scope, inputs,
   account generation, enabled status and action authority before execution.
4. The routine uses account-scoped stored data with visible source freshness.
   Refreshes and writes use the registered provider connection, not credentials
   pasted into prompts. Native-only grants need a supported new connection;
   their transferability must not be assumed.
5. The existing durable command queue runs the approved implementation, including
   registered n8n workflows where applicable. Store the result and execution
   evidence before making it eligible for delivery.
6. The outbox rechecks the original client/route/sender binding and returns the
   result to the originating Slack thread. No fallback to another room or DM.
   Retries must not repeat uncertain provider actions or duplicate messages.

The agent is therefore a conversational entry point to tested routines, not a
second unconstrained automation system. Enabling 1/7 or 3/7 routines changes the
allowlist; it does not require seven combinations of duplicate workflows.

## Origin capture batch

The Slack event and message-button parsers now preserve `conversationId` and the
exact string `threadId`, independently of sender `externalId` and workspace
`scopeId`. Top-level messages use their own timestamp as the prospective thread
root. Message buttons retain the message's root thread. Missing message origins,
contradictory message timestamps and malformed thread timestamps are refused;
an App Home/modal interaction does not silently become a DM approval.

The durable ingress snapshot retains those fields, strips unknown authority
fields, and detects changed/lost thread metadata in its persisted readback.
This is **origin capture only**. It does not yet change account lookup, authorize
shared rooms, propagate origin through commands/outbox, or change Slack delivery.
Do not deploy this as a claim that shared-channel routing is finished.

Local verification: 3,083 tests across 228 files pass, application TypeScript
passes, and focused ESLint passes. No provider calls, route migration or customer
messages were used to obtain these results. Production is unchanged.

## Conversation registry batch

`20260905220557_slack_conversation_registry.sql` adds a private, RLS-enabled
workspace/channel registry with service-only invoker RPCs. It does not alter the
existing OAuth link uniqueness or move a connection between client accounts.
The owner must hold a verified Slack identity and current ownership of the
target account. One such identity can provision separate channels for two owned
accounts without duplicating OAuth. Other senders must independently have a
verified Slack identity plus current membership of the routed client account.

`slackRoutes.ts` verifies preflight identity before touching the token resolver,
checks `auth.test` against the registered workspace bot, then checks the exact
channel with `conversations.info`. The channel must contain the bot, be
unarchived and have explicit non-shared status. Slack Connect/org-shared channels
are not accepted in this initial implementation; they need explicit audience
and external-user policy, not a silent fallback. Missing channel metadata scopes
produce a reconnect requirement; this batch does not request new OAuth consent.
Public/private channel metadata needs `channels:read`/`groups:read`; these are
recorded requirements, not newly granted permissions.

All registrations start **staged**. A second binding cannot steal an existing
channel. Concurrent identical staging converges on one row. The resolver refuses
inactive routes, paused/reset accounts, removed owners/members and changed or
unverified OAuth identities. It returns an origin-checked candidate with route
and identity revisions, **not a durable execution or delivery grant**.

Real local PostgreSQL verification executes the exact migration against minimal
dependency tables from the existing migrations. It proves two-client resolution,
wrong-room/workspace/member refusal, identity revision invalidation, pause/reset,
revocation, immutable route identity, concurrent staging, RPC grants and private
RLS. Tests activate synthetic fixtures directly; **no production activation
endpoint or cutover approval was implemented or exercised**.

Reproduce: `node scripts/verify-slack-conversation-registry.mjs /tmp/unc-manual-pg.x8Y6jR`
(the existing isolated pinned PostgreSQL dependency directory). No production
credentials are read, and no provider/customer messages are sent. The isolated
cluster is stopped in `finally`; test data is retained in its reported temp path.

This migration is **not applied to production**. The server staging/resolution
adapters are tested but not exposed by a UI/API or connected to live ingress.
Next is atomic inbox capture/reverification of the route alongside the sender,
without treating an OAuth link's original account as the conversation's account.
Commands, outbox and approval receipts must preserve that same bound origin.
Do not enable a route before that complete path and controlled cutover pass.
Rebinding a reserved/revoked channel is deliberately unavailable until the
explicit cutover/retention path is built; deleting audit evidence is not a shortcut.

## Durable routed pipeline batch

`20260905221238_slack_routed_inbox.sql` and the matching application/worker code
now connect the registry to intake, control handling, command bindings, outbox
claims and thread-history projection. The migration is **local only** and must
follow the registry migration in a coordinated release.

A routed destination is a distinct `channel_links.slack_route_id` key space,
not a replacement OAuth identity. Atomic ingress resolves the registered room
and current sender membership, creates/reuses its account-bound destination and
captures that destination's immutable binding revision. Unknown, inactive or
missing room routes never fall back to the sender's DM account. Link codes
pasted in rooms cannot transfer an identity. The direct-link lookup, install
lookup, channel list and proactive recipient set exclude routed destinations.

The normal verifier rechecks route revision, source OAuth link/revision and
membership alongside the existing account generation/destination checks. A
changed route cancels queued delivery; a new inbound event can capture the new
revision, while a replay retains its old envelope and fails verification.
Control receipts, queued commands and asynchronous notification preparation use
the same account-bound destination. Notification delivery resumes the existing
outbox operation by ID instead of rebuilding it from a polling worker's reply.

The Slack adapter posts to the bound conversation with the original `thread_ts`
and `reply_broadcast: false`. Room destinations cannot fall back to a DM. A
provider response naming a different destination is uncertain, not a successful
delivery or permission to resend. Room approval acknowledgements do not use the
separate `response_url` mutation path. Immediate reply helpers reject attempts
to override the captured thread. Inbound and projected outbound messages retain
an explicit Slack audience; model conversation history is filtered to that
workspace/channel/thread. Account context/data permissions remain independently
enforced; this is not a claim that every provider/routine is ready.

Verification: 3,123 tests across 230 files, app/worker TypeScript, focused ESLint
and a Next production build pass. Seven new application/provider-shape tests
cover origin propagation, history isolation, direct-versus-routed identity,
proactive exclusion, command serialization and no-DM-fallback behavior.
`scripts/verify-slack-routed-pipeline.mjs` executes the exact migrations and
existing inbox/control/outbox/command functions on real isolated PostgreSQL,
against minimal dependency tables. It proves two-client capture, concurrent
dedupe, control validation, command notification preparation, projection,
revocation and old-binding refusal. Synthetic outbox acceptance records are
test fixtures: no Slack or other provider was called and no routine/provider
execution or real customer delivery is claimed.

The SQL harness caught an initial migration-generation string substitution error;
that was corrected before the passing run. A replay assertion was also corrected
to test immutable event/binding identity rather than expecting mutable status and
control-result fields to stay unchanged. No failing migration reached production.

Reproduce: `node scripts/verify-slack-routed-pipeline.mjs /tmp/unc-manual-pg.x8Y6jR`.
The fixture cluster is stopped after the test, with its synthetic data retained at
the printed temp path. The production app/worker still run the preceding release;
neither Slack migration has been applied remotely or any native listener changed.

## Remaining implementation and cutover gates

- Owner setup/readback is now implemented locally (see batch below). Codex still
  needs explicit revision-bound activation/deactivation and retained-history
  cutover/rebinding; staging never silently overwrites active or revoked routes.
- Codex: release the three migrations and matching app/worker with messaging still
  disabled, then verify the deployed route/command/outbox path before pilot use.
- Codex: verify provider grants and per-client routine mappings; expose stale,
  expired and missing connections as actionable failures, not successful work.
- Codex: test two clients sharing a Slack sender, wrong-room refusal, removed
  membership, route revision changes, replay, uncertain delivery and recovery.
  Proactive messages need one explicit audience binding, not one post per member.
- Nguyen: complete the agreed workflow contracts and provider-backed execution
  evidence. Do not redesign frozen wrappers merely for the Slack migration.
- Owner/workspace admin where required: approve the exact app installation,
  client route and bounded pilot/cutover. No new customer messages in this batch.

Keep existing Hyperagent listeners unchanged until the Junction path has passed
an authorized pilot. Cut over one client/channel at a time, with one active
responder and a rollback path. Keeping the same channel does not mean Junction
can inherit Hyperagent's bot identity or OAuth tokens.

Official references consulted: [Slack app mentions](https://docs.slack.dev/reference/events/app_mention/)
and [message interaction payloads](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload/).

## Owner setup/readback batch — 6 September NZ

Migration `20260905222650_slack_route_owner_setup.sql` adds one read-only,
service-role-only security-invoker RPC. The authenticated owner is resolved by
the application; membership and account generation are independently checked in
SQL. Available direct identities may originate from another account where the
owner remains a member; routed delivery destinations never appear as OAuth
identities. Only this client's mappings are returned. Credential existence is
a boolean, not proof the token can still be used. No token/ciphertext or other
account's name, mappings or business context is exposed.

`/api/channels/slack/routes` GET establishes the authenticated actor in the
context-bound response. POST accepts only identity ID/version, workspace and
channel ID, requires that actor header and checks account context again. It uses
the existing provider-verification/staging path, then independently reads and
validates the resulting staged mapping. No API activation operation exists.
Unknown fields, cross-origin requests and mismatched readbacks are rejected;
arbitrary provider/database errors are not reflected in the response.

`SlackRouteSetupPanel` is mounted in Connections / Messaging and legacy Channels
when a real account context exists. There is no auto-selected connection or
channel, no blind reinstall, no optimistic success and no automatic save retry.
An uncertain save clears the mutation-capable snapshot until a fresh read;
changing account/generation destroys stale state and ignores late responses.
Saved state, revision and last resource-check time are explicitly not called
live delivery. A paused client can prepare a mapping without being unpaused.

Verification: 15 API/client contract tests, full 3,138-test suite (231 files),
six isolated browser checks, actual PostgreSQL pipeline/owner-grant checks,
app/worker TypeScript, focused ESLint and production build pass. Mobile/desktop
screenshots inspected; fixtures exercise the real component but use synthetic
server responses. No provider call, customer message or production change.

Still required: supported Slack installation/scopes, per-client membership,
explicit revision-bound lifecycle, coordinated deployment and authorized pilot
cutover. Existing OAuth requested scopes have not yet been expanded for room
metadata; a missing-scope failure asks for an installation review rather than
silently reinstalling. The application's first-membership session selection also
remains an explicit multi-client management limitation. Do not count this UI as
acceptance of all client channels or all routines.
