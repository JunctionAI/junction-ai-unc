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

## Real Slack install and origin fix — Batch 81

6 September NZ. This closes the actual dedicated-app installation gap, not the
channel/routine delivery gap. Runtime source remains
`781dfe740026b9148396a2bf55c64b537d347c48`.

- Provisioned app `A0BV96C6BFC` client ID/secret/signing secret directly from its
  authorized settings into Vercel Production Secret variables and Fly secrets.
  No plaintext secret was printed, written to a local file or committed. These
  are new Junction credentials, not copied Hyperagent bot tokens.
- Fly release **42**, machine `1857466fd76998`, source/image unchanged from
  release 41: `sha256:72b81267d9b140225498ebf65dda335749d25698a19dfb67f3c13bb9129f97f0`.
  Independent process fingerprint checks confirmed all three app values match;
  only match booleans were emitted. No action flags changed.
- Initial credential-config app `dpl_6UE5KBtMSB3mgkQpFm3Q6rtQhgCu` passed a
  real-key synthetic signed URL challenge (200/exact echo) and invalid-signature
  refusal (401). This was not an actual Slack event or delivery test.
- Real owner OAuth then failed at Slack before code exchange: the runtime's
  APP_URL was `https://getjunction.ai`, whose `/api/health` returned 404 because
  it belongs to the separate marketing project. Corrected APP_URL and
  NEXT_PUBLIC_APP_URL to `https://junction-unc.vercel.app`. CLI updates applied
  to their existing **Production and Preview** rows. No domain reassignment or
  additional Slack callback URI was made; worker APP_URL was already correct.
- Final corrected app **`dpl_5Bg9bHmN5UPY98D54yaBfBZvQJQM`**, immutable URL
  `https://junction-ecm262fvj-tom-junctionmedis-projects.vercel.app`, READY and
  promoted after candidate health. Next 16.3.4 production build completed in
  28 seconds. Clean release checkout excludes the user's `context 2.ts`.
  Canonical health at `2026-09-05T23:05:10.226Z` reports source `781dfe740026`,
  database healthy, worker fresh and lastError null.
- Fresh Junction start superseded the failed nonce; Slack consent displayed
  exactly Junction Unc / Junction AI and eight bot scopes, no user scopes.
  Authorized installation saved link **`781b8885-8b1d-4181-894a-a3c9e977ccf7`**
  at `2026-09-05T23:05:46.814891Z`, account
  `aa5cfc84-2569-4c99-9b40-67003ae55eda`, owner
  `74802c60-149a-4405-b719-dc058d174072`, Slack user `U0BLLM1NDNV`, workspace
  `T0BMD3LMWUQ`, bot `U0BV96TRXK4`, identity revision 0. Independent DB read
  confirms one sealed key-version-1 workspace credential, zero install pins
  and zero routes. Ciphertext/token contents were not returned.
- Independent worker `auth.test` with the stored, decrypted-in-process token at
  **23:06:33.557 UTC** returned HTTP 200 / ok true, matching team and bot, bot ID
  `B0BUTRX5JBZ`, granted scopes `chat:write,im:write,app_mentions:read,im:history,
  im:read,channels:read,groups:read,users:read`. This proves app/worker keyring
  interoperability and a fresh provider-auth read, not a message send.
- Owner UI independently displays Linked / Junction AI and the new channel
  staging form. Eight saved runs remain visible, AVGAR stays paused generation 1.
  Worker flags UNC_COMMANDS_ENABLED, UNC_MESSAGING_ENABLED, LIVE_MODE_ENABLED,
  TNZ_SMS_ENABLED and APPLE_MESSAGES_ENABLED all read **false**. No Events,
  interactivity, Hyperagent listener, Nguyen workflow or customer send changed.
  Bounded error/fatal scan of the final app returned no entries.

**Remaining:** exact client channel/provider membership binding, route
activation/deactivation/rebinding with revision-bound authority, scoped pilot
approval and actual same-thread request/result delivery. Legacy digest switch
copy is not a delivery receipt. Do not treat one owner install as all clients'
membership or credential coverage.

**Rollback:** the preceding app `dpl_6UE5KBtMSB3mgkQpFm3Q6rtQhgCu` contains the
wrong-origin config and must not be promoted as an OAuth repair. Prior source
and image are identical, so rebuild with the corrected origin for runtime
rollback. Reverting a deployment does not uninstall Slack or revoke the stored
grant; preserve the verified identity/history and use the explicit owner-bound
unlink path if revocation is required. Do not delete the grant to simulate a
successful rollback. Action gates remain off throughout.

## Setup-only install authority — Batch 78, local only

Historical implementation status below; now released in Batch 79.

The next install slice implements `begin_slack_install`, `check_slack_install`,
`finish_slack_install` and `unlink_slack_identity` in
`20260905223939_slack_install_authority.sql`. The private current-attempt pin
survives single-use OAuth state consumption, so the final transaction can
independently check the exact owner/account generation and consent snapshot.
No bot token or provider secret is placed in that pin. Existing OAuth identities
and workspace credential ownership are preserved across legitimate client reuse.

The callback stores grant plus identity atomically, refuses changed bot identity
as an explicit cutover dependency, and never sends a welcome message. Unlink
invalidates verification without deleting historical identity/FK records and
preserves credentials still used by another verified direct identity. The app
requires current account generation and identity revision for Slack unlink and
does not display success for missing/negative/uncertain acknowledgements.

`channels:read` and `groups:read` are now in the requested consent scopes. Signed
URL-verification challenges can be answered with messaging disabled; normal
message events remain refused. Availability exposes setup-only status rather
than claiming delivery. This has not granted provider scopes or changed Slack's
Event Subscriptions, installed bot, channel membership or Hyperagent listener.

Local verification: 3,144 tests in 231 files, both typechecks, Next production
build and focused lint pass (two existing component warnings). Exact migration
SQL passes the real local PostgreSQL harness, including superseded consent,
owner/context changes, one-use completion, no account transfer, changed bot,
credential-race refusal, no grant mutation after refusal, revision-bound unlink,
shared credential/history preservation and private/service-only access. Provider
transport tests use synthetic responses; there is no live OAuth acceptance yet.

Release this additive schema and matching app/worker before asking the owner to
reconnect. Then verify actual app configuration and grants, build the explicit
revision-bound route activation/deactivation/cutover path, and perform a scoped
client Slack pilot. Do not treat a staged route or installed grant as permission
to enable customer messaging. Dedicated expired-pin retention cleanup remains;
pins expire after ten minutes and the next attempt replaces the same owner/client
pin, but expiration alone does not delete it.

## Matched install release — Batch 79

6 September 2026 NZ. Source `781dfe740026b9148396a2bf55c64b537d347c48`,
independently read back on GitHub branch `codex/backend-foundation-20260905`.
Clean detached release checkout `/private/tmp/unc-slack-install-release.IJ7DTr`;
the user's untracked `context 2.ts` was not included. No env files copied/pulled.

- Remote migration `20260905224817_slack_install_authority` applied before
  promotion; local filename remains CLI-created `20260905223939`.
  At 22:48:33 UTC all four function body hashes match the local source:
  begin `32782f3d3f0786a58e3fffb821fd28e5`, check
  `a0f85309743617e5b1ef260feed5e397`, finish
  `1de2b1096f5cba2da2d63f9fab9c7cf1`, unlink
  `5661ea4c1c422734f403906fd8553392`. All use security invoker and empty
  search paths, allow service execution, and deny anon/authenticated execution.
  Private install table has RLS and no anon/member SELECT. A rollback-only
  service-role invalid-context check returned false.
- Vercel `dpl_4n1o1YVNDRvnwHmgFYqkRYHmFAC5`, immutable URL
  `https://junction-hus22vzxu-tom-junctionmedis-projects.vercel.app`, production
  target, READY, 41-second Next 16.3.4 build. Both build/runtime SHA variables
  were pinned. Candidate health and unauthenticated setup refusal checked before
  successful promotion. Canonical health at 22:50:34.814 UTC reports SHA
  `781dfe740026`, database healthy, worker fresh, lastError null.
- Fly release 41, Sydney machine `1857466fd76998`, image digest
  `sha256:72b81267d9b140225498ebf65dda335749d25698a19dfb67f3c13bb9129f97f0`.
  Existing machine update only; smoke/health checks pass. Actual running worker
  readback at 22:50:18.709 UTC confirms full SHA, successful invalid-authority RPC
  refusal, all five command/messaging/live/TNZ/Apple flags false, command scopes
  absent and data sync unset. No secrets printed.
- Signed-in canonical Connections → Messaging reload succeeds. It shows paused
  account, eight inbox results, no verified Junction Slack identity, and Slack
  unavailable. This confirms configuration/installation is still outstanding;
  no OAuth consent, channel staging, activation or message delivery was tested.
  DB at 22:50:53.229 UTC confirms 0 links, 0 routes, 0 install attempts and 8
  AVGAR runs, with generation 1 / pause true preserved.
- Error/fatal scan restricted to this deployment and the prior 15 minutes returns
  no entries. Current Vercel drains list is empty. Security advisors remain six
  pre-existing WARN, now 22 INFO (new private RLS-without-browser-policy table).
  Monitoring/alert delivery is not claimed complete.

Rollback target: previous app `dpl_HJhyQAPpUibCEsumu7k5Bca5ZRHU`, worker 40 image
`sha256:650d32fb4d7cc349ce1e94e6ebe92feea4daa302463fabc77c20195e5f0e84b4`,
source `8711a48b94e1d3e9e337ea6e9e5e35853a183603`. Keep all action flags off.
The additive schema can remain, but rolling back reintroduces the old OAuth
callback: disable/install-fence that old path before rollback if real identities
have since been connected. Reconcile grants and pending attempts, never delete
identity/route history as a rollback shortcut.

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
  disabled — deployed in Batch 77 below. Live route/command/outbox acceptance still
  requires a scoped pilot; release health alone is not that proof.
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

## Matched release — Batch 77, 6 September NZ

Released source `8711a48b94e1d3e9e337ea6e9e5e35853a183603` from the clean detached
worktree `/private/tmp/unc-slack-setup-release.C1pfXf`. The unrelated untracked
`src/lib/runtime/context 2.ts` was excluded and remains untouched. No source or
credential export from Hyperagent, new route, OAuth consent, provider call,
Nguyen workflow edit or customer message was made.

### Database

At 22:33:04 UTC, live preflight confirmed zero channel links, no previous Slack
registry schema, eight AVGAR runs and paused generation 1. Applied the tested
migrations in order; remote history timestamps differ from local CLI-created
filenames, but names and definitions match:

| Local migration prefix | Remote history version | Name |
| --- | --- | --- |
| 20260905220557 | 20260905223350 | slack_conversation_registry |
| 20260905221238 | 20260905223355 | slack_routed_inbox |
| 20260905222650 | 20260905223359 | slack_route_owner_setup |

Independent readback at 22:34:21 UTC matched all 12 affected function-body MD5s
to local source. Every affected function is security-invoker with an empty
search path and no anonymous/authenticated execute grant. Private registry RLS
is enabled. Both partial identity indexes exist with the intended direct/routed
predicates. Real owner readback returns generation 1, paused, empty identities
and routes, activation unavailable and executedAction none. No setup data seeded.
Security advisors retain the six pre-existing WARNs; INFO increases 20→21 for
the intentionally server-only registry table with no browser RLS policy.

### Deploy Result

- Production: https://junction-unc.vercel.app/app
- Immutable app: https://junction-ka16qj618-tom-junctionmedis-projects.vercel.app
- Deployment: `dpl_HJhyQAPpUibCEsumu7k5Bca5ZRHU`, READY/promoted, Next 16.3.4.
- Cloud build output: 46 seconds.
- Worker: release 40, existing Sydney machine `1857466fd76998`, started/healthy.
- Image: `sha256:650d32fb4d7cc349ce1e94e6ebe92feea4daa302463fabc77c20195e5f0e84b4`.

Candidate health reported expected `8711a48b94e1` and a healthy database;
unauthenticated setup GET returned 401 and `private, no-store`. Before promotion,
the actual new worker was read at 22:35:55 UTC: full source SHA matches, compiled
Slack adapter/outbox present, all five command/message/live/phone flags false,
data sync unset, no command-release scope. Its real owner setup RPC passes with
the same empty paused state. Canonical health at 22:36:28 UTC reports the new
app SHA, healthy DB and a fresh worker heartbeat with no lastError.

The signed-in canonical owner UI independently loads Connections → Messaging,
the new client channel panel, the paused-account notice and the exact absence of
a verified Junction Slack identity. Existing eight inbox items remain visible;
all outward-channel controls remain disabled. No setup POST was made. The initial
loading state settled into the expected empty setup, not a fabricated connection.

Bounded deployment-specific error/fatal log scan returned no entries. This is
not monitoring-alert delivery or an observation-period acceptance test. Drains
were not freshly checked; previous evidence reported none.

Rollback: previous app `dpl_3FkwzcnQeRzJFgKFH7aodZYD7PRj`, source `4067b08`,
worker release 39 image
`sha256:e12780b89affe9cc8fa71759f7a60f6e96db2b4dacd84b3d3ce4a1daf5705f5b`.
Keep messaging/commands disabled and reconcile current route/link state before
rollback. Do not drop the registry or delete historical routes to roll back code.
No previous channel rows existed when this schema was introduced.

### Concrete next integration work

The released UI accurately exposes a real setup gap: no Junction Slack identity
is connected. Existing Hyperagent access does not fill it. Before asking the owner
to reconnect anything, finish the installation/lifecycle slice:

- Separate preparatory OAuth/channel verification from message delivery. The
  current channel chooser disables Slack setup with the messaging flag even
  though the owner start endpoint can initiate OAuth. The webhook also gates
  provider handshake traffic; review signed verification separately from events.
- Review metadata scopes and the existing app configuration; current requested
  scopes omit channels:read/groups:read required by the staging verifier.
- Make OAuth finish/link/secret updates and unlink safe for shared workspace
  credentials. Current unlink checks other links only in the selected account
  before deleting the workspace-wide secret; other legitimate identities must
  not lose their shared bot credential accidentally.
- Add revision-bound route disable/reverification/cutover without deleting history
  or reassigning another client's channel. Activation remains a separate scoped
  pilot decision, never a consequence of connecting OAuth.

These are Codex-owned implementation tasks, not reasons to tell Tom or Nguyen to
debug the integration. New app consent and the exact listener cutover remain
explicit authority gates after the setup path is sound.
